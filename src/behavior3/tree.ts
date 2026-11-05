import { Blackboard } from "./blackboard";
import { Context } from "./context";
import { Node, NodeData, Status } from "./node";

export interface TreeData {
    /** The document version written by the editor, the runtime doesn't check it. */
    readonly version?: string;
    readonly name: string;
    readonly desc: string;
    readonly root: NodeData;
    readonly group: string[];
}

/**
 * The events of the lifecycle of a tree, dispatched with the tree as the target. An exception
 * thrown by a listener is logged, the other listeners and the tree go on.
 */
export const enum TreeEvent {
    CLEANED = "treeCleaned",
    INTERRUPTED = "treeInterrupted",
    /** A node throws an exception while ticking, args: `(error: Error, node: Node)`. */
    EXCEPTION = "treeException",
    BEFORE_TICKED = "treeBeforeTicked",
    AFTER_TICKED = "treeAfterTicked",
    TICKED_SUCCESS = "treeTickedSuccess",
    TICKED_FAILURE = "treeTickedFailure",
}

/**
 * The status of the tree.
 * + `error`: A node returns `error` and it is not handled by `ErrorToFailure`.
 * + `interrupted`: The tree is interrupted by `tree.interrupt()`.
 * + `exception`: A node throws in this tick, the tree is interrupted.
 */
export type TreeStatus = Status | "interrupted" | "exception";

let treeId = 0;

/**
 * Rejects a callback of `bindCallback` which may return a promise, the key is shown in the
 * compile error. `never` (a callback which only throws) is accepted.
 */
type SyncCallback<R> = [Extract<R, PromiseLike<unknown>>] extends [never]
    ? unknown
    : { "bindCallback: the callback must be synchronous, not async": never };

const isThenable = (value: unknown): value is PromiseLike<unknown> =>
    !!value &&
    (typeof value === "object" || typeof value === "function") &&
    typeof (value as PromiseLike<unknown>).then === "function";

/** The state of a running node which has not set its own state. */
const RUNNING = {};

export class Tree<C extends Context, Owner> {
    readonly context: C;
    readonly path: string;
    readonly id: number = ++treeId;

    debug: boolean = false;

    protected _ticking: boolean = false;
    protected _owner: Owner;

    /** @private */
    __runningNode: Node | undefined = undefined;

    /** @private */
    __interrupted: boolean = false;

    private _root?: Node;
    private readonly _rootBlackboard: Blackboard;
    /** The current scope, switched by `Scope` nodes and condition trees while ticking. */
    private _scope: Blackboard;
    private _status: TreeStatus = "success";
    private _states: unknown[] = [];
    private _tickException: boolean = false;
    private _callback?: { interrupt: boolean };
    /**
     * How many executions are on the stack: `tick`, `__tickInCallback`, the callbacks from
     * `bindCallback` and `interrupt` aborting the nodes. A `clear` while executing waits until it
     * is back to 0.
     */
    private _executing: number = 0;
    /** `clear` is called while executing, the tree is cleared when the execution exits. */
    private _pendingClear: boolean = false;
    /** `clear` is running, a `clear` from its listeners is ignored. */
    private _clearing: boolean = false;
    /** How many times the tree is cleared, a callback bound before a clear is skipped. */
    private _clearCount: number = 0;
    /** The tick count when the node is ticked last time, only recorded in debug mode. */
    private _ticked: number[] = [];
    private _tickCount: number = 0;
    private _loadError?: Error;

    constructor(context: C, owner: Owner, path: string) {
        this.context = context;
        this.path = path;
        this._rootBlackboard = this._scope = new Blackboard(this);
        this._owner = owner;
        // an error thrown synchronously (like a config error found when creating the nodes) goes
        // to the caller; a rejected load is recorded, the tree stays failed
        Promise.resolve(this.context.loadTree(this.path)).catch((e: unknown) => {
            const error = e instanceof Error ? e : new Error(String(e));
            this._loadError = error;
            console.error(
                `behavior3: load tree '${this.path}' failed: ${error.stack ?? error.message}`,
            );
        });
    }

    get owner() {
        return this._owner;
    }

    /**
     * The blackboard of the current scope. Outside a tick it is the root blackboard of the tree,
     * inside a `Scope` node or a condition tree it is the overlay of the scope.
     */
    get blackboard(): Blackboard {
        return this._scope;
    }

    /** @private The root blackboard, for the framework only. */
    get __rootBlackboard(): Blackboard {
        return this._rootBlackboard;
    }

    /** @private Sets the current scope and returns the previous one, restore it with `finally`. */
    __swapScope(scope: Blackboard): Blackboard {
        const outer = this._scope;
        this._scope = scope;
        return outer;
    }

    /** @private Runs `fn` in the scope. */
    __withScope<T>(scope: Blackboard, fn: () => T): T {
        const outer = this.__swapScope(scope);
        try {
            return fn();
        } finally {
            this._scope = outer;
        }
    }

    /**
     * Binds a callback to the current scope, call it in `onTick` when registering a listener or
     * a timer. The returned function runs `fn` in the scope where it was bound, even if that
     * `Scope` or condition tree has ended (like a closure): `tree.blackboard` is the bound scope,
     * and the children ticked by `__tickInCallback` run in it.
     *
     * `fn` must be synchronous: the scope is bound while `fn` runs, the code after an `await`
     * would run in whatever scope is current then. An async `fn` is a compile error, and throws
     * when called. For an async task, bind the synchronous callback called when it completes:
     * `task.then(tree.bindCallback((result) => { ... }))`.
     *
     * The returned function does nothing and returns `undefined` once the tree is cleared, a
     * callback the tree can't remove (like a promise) doesn't run on the cleared tree.
     */
    bindCallback<F extends (...args: never[]) => unknown>(
        fn: F & SyncCallback<ReturnType<F>>,
    ): (...args: Parameters<F>) => ReturnType<F> | undefined {
        const scope = this._scope;
        const cleared = this._clearCount;
        return (...args: Parameters<F>) => {
            if (this._clearCount !== cleared) {
                return undefined;
            }
            const outer = this.__swapScope(scope);
            this._executing++;
            try {
                const result = fn(...args) as ReturnType<F>;
                if (isThenable(result)) {
                    throw new Error(
                        `tree '${this.path}': the callback of bindCallback must be synchronous, ` +
                            `the code after 'await' would run out of the bound scope`,
                    );
                }
                return result;
            } finally {
                this._scope = outer;
                this._exitExecution();
            }
        };
    }

    get root(): Node | undefined {
        return (this._root ||= this.context.trees[this.path]);
    }

    /** Whether the tree is loaded. */
    get ready() {
        return !!this.root;
    }

    /**
     * The error of a failed load, `undefined` while loading or once loaded. A failed tree stays
     * failed, `tick` returns `error`; retry in the `loadTree` of the context if needed.
     */
    get loadError(): Error | undefined {
        return this.root ? undefined : this._loadError;
    }

    get status() {
        return this._status;
    }

    get ticking() {
        return this._ticking;
    }

    /**
     * Whether the tree is executing: ticking, ticking its nodes in a callback (like `Listen` and
     * `Delay`), running a callback from `bindCallback`, or aborting its running nodes when
     * interrupted outside the tick. It can't be ticked meanwhile.
     */
    get executing() {
        return this._executing > 0;
    }

    get runningNode() {
        return this.__runningNode;
    }

    /**
     * Clears the tree: dispatches `CLEANED`, interrupts the tree (`INTERRUPTED`, `onAbort` of the
     * running nodes), calls `onClear` of every node, then clears the states, the blackboard and
     * the listeners.
     *
     * Called while the tree is executing (in `tick`, a callback ticking the nodes or a callback
     * from `bindCallback`), it stops the execution and clears the tree when the outermost one
     * exits, still in the same call stack: the nodes on the stack must not go on with the cleared
     * states, and the rest of a callback (like `Delay` restoring its cached variables) runs
     * before the clear.
     */
    clear() {
        if (this._clearing) {
            return;
        } else if (this._executing > 0) {
            this._pendingClear = true;
            this.__interrupted = true;
            if (this._callback) {
                this._callback.interrupt = true;
            }
            return;
        }
        this._doClear();
    }

    /** Clears the tree from the root blackboard, the whole tree is cleared in it. */
    private _doClear() {
        this._pendingClear = false;
        this._clearing = true;
        const outer = this.__swapScope(this._rootBlackboard);
        try {
            // force run clear
            const interrupted = this.__interrupted;
            this.__interrupted = false;
            this.context.__dispatchIsolated(this.path, TreeEvent.CLEANED, this);
            this.__interrupted = interrupted;

            this.interrupt();
            if (this.root) {
                // after the running nodes are aborted, before the private vars are cleared
                this._clearAll(this.root);
            }
            this.debug = false;
            this.__interrupted = false;
            this._status = "success";
            this._states.length = 0;
            this._rootBlackboard.clear();
            this.context.offAll(this);
            // after CLEANED and INTERRUPTED, whose listeners still run
            this._clearCount++;
        } finally {
            this._scope = outer;
            this._clearing = false;
        }
    }

    /** Leaves an execution, clears the tree if `clear` was called in the outermost one. */
    private _exitExecution() {
        if (--this._executing === 0 && this._pendingClear) {
            this._doClear();
        }
    }

    interrupt() {
        if (this._status === "running" || this._ticking) {
            this.context.__dispatchIsolated(this.path, TreeEvent.INTERRUPTED, this);
            this.__interrupted = true;
            if (this._callback) {
                this._callback.interrupt = true;
            } else if (!this._ticking) {
                // an execution: a `clear` from `onAbort` waits until every running node is aborted
                this._executing++;
                try {
                    this._doInterrupt();
                } finally {
                    this._exitExecution();
                }
            }
        }
    }

    /**
     * @private Ticks the node in an async callback (like `Listen` and `Delay`), which is
     * independent of `tick`. An error or an exception only stops this subtree without affecting
     * the tree, and the running nodes left in the subtree are aborted.
     *
     * @param scope The scope to tick the node in, the current scope by default: the bound scope in
     * a callback from `bindCallback`, the root blackboard in a callback outside the tick.
     */
    __tickInCallback(node: Node, scope: Blackboard = this._scope) {
        const outer = this._callback;
        const interrupted = this.__interrupted;
        const runningNode = this.__runningNode;
        const callback = (this._callback = { interrupt: false });
        this.__interrupted = false;

        const outerScope = this.__swapScope(scope);
        this._executing++;
        try {
            try {
                node.tick(this);
                this.__abortAll(node);
            } finally {
                this._scope = outerScope;
            }

            this._callback = outer;
            this.__runningNode = runningNode;
            this.__interrupted = interrupted || callback.interrupt;
            if (callback.interrupt) {
                if (outer) {
                    outer.interrupt = true;
                } else if (this._ticking || this._pendingClear) {
                    // the tick handles it, or the clear when the outermost execution exits
                } else {
                    this._doInterrupt();
                }
            }
        } finally {
            this._exitExecution();
        }
    }

    /** @private Called when a node throws, dispatches `EXCEPTION` and stops the tick. */
    __exception(node: Node, error: Error) {
        this.context.__dispatchIsolated(this.path, TreeEvent.EXCEPTION, this, error, node);
        if (this._callback) {
            // only stops the subtree of the callback
            this.__interrupted = true;
        } else {
            this._tickException = true;
            this.interrupt();
        }
    }

    /**
     * Gets the state of the node, which is kept while the node is running.
     */
    getState<V = unknown>(node: Node): V | undefined {
        const value = this._states[node.index];
        return (value === RUNNING ? undefined : value) as V | undefined;
    }

    /**
     * Sets the state of the node, call it when returning `running`.
     * The state is cleared when the node finishes or is aborted.
     */
    setState<V = unknown>(node: Node, value: V) {
        this._ensureStates(node.index);
        this._states[node.index] = value ?? RUNNING;
    }

    /**
     * Whether the node returned `running` in the last tick and has not finished or been aborted.
     */
    isRunning(node: Node) {
        return this._states[node.index] !== undefined;
    }

    /** @private */
    __markRunning(node: Node) {
        this._ensureStates(node.index);
        this._states[node.index] = RUNNING;
    }

    /** @private */
    __clearState(node: Node) {
        if (node.index < this._states.length) {
            this._states[node.index] = undefined;
        }
    }

    /** @private */
    __markTicked(node: Node) {
        this._ticked[node.index] = this._tickCount;
    }

    /**
     * Debug mode only: a running node which is not ticked in this tick has been left behind by
     * its parent without being aborted, it will resume from the stale state next time.
     */
    private _checkMissingAbort(node: Node) {
        if (this.isRunning(node) && this._ticked[node.index] !== this._tickCount) {
            node.warn(`still running but not ticked in this tick, missing abort?`);
        }
        for (const child of node.children) {
            this._checkMissingAbort(child);
        }
    }

    /** Keeps the states array packed, a sparse array is much slower. */
    private _ensureStates(index: number) {
        const states = this._states;
        while (states.length <= index) {
            states.push(undefined);
        }
    }

    tick(): TreeStatus {
        const { context, root } = this;

        if (!root) {
            // `failure` while loading, `error` if the load failed
            return this._loadError ? "error" : "failure";
        }

        if (this.debug) {
            console.debug(`---------------- debug ai: ${this.path} --------------------`);
        }

        if (this._ticking) {
            const node = this.__runningNode;
            throw new Error(`tree '${this.path}' already ticking: ${node?.name}#${node?.id}`);
        } else if (this._executing > 0) {
            // like ticking it in a node: the nodes of the callback (or being aborted) are on the
            // stack, and the tick would run the whole tree in the middle of it (like a callback of
            // a subtree ticking the caller, which runs the subtree again by `RunTree`)
            throw new Error(
                `tree '${this.path}' is executing (a callback or an abort), it can't be ticked ` +
                    `until it returns`,
            );
        }

        this._ticking = true;
        this._tickException = false;
        // the tree is ticked from the root blackboard
        const outerScope = this.__swapScope(this._rootBlackboard);
        this._executing++;
        let cleared = false;
        try {
            if (!this.isRunning(root)) {
                context.__dispatchIsolated(this.path, TreeEvent.BEFORE_TICKED, this);
            }

            const status: Status = root.tick(this);

            if (status === "success") {
                this.__runningNode = undefined;
                this._status = "success";
                context.__dispatchIsolated(this.path, TreeEvent.AFTER_TICKED, this);
                context.__dispatchIsolated(this.path, TreeEvent.TICKED_SUCCESS, this);
            } else if (status === "failure") {
                this._status = "failure";
                this.__runningNode = undefined;
                context.__dispatchIsolated(this.path, TreeEvent.AFTER_TICKED, this);
                context.__dispatchIsolated(this.path, TreeEvent.TICKED_FAILURE, this);
            } else if (status === "error") {
                // finished like `failure`, the error is logged by the node returning it
                this._status = "error";
                this.__runningNode = undefined;
                context.__dispatchIsolated(this.path, TreeEvent.AFTER_TICKED, this);
            } else {
                this._status = "running";
            }

            if (this._pendingClear) {
                // cleared when the outermost execution exits
            } else if (this.__interrupted) {
                this._doInterrupt();
            } else if (this.debug) {
                this._checkMissingAbort(root);
            }

            this._tickCount++;
        } finally {
            // stopped by a clear, done below when the execution exits
            cleared = this._pendingClear;
            this._scope = outerScope;
            this._ticking = false;
            this._exitExecution();
        }

        return cleared ? "interrupted" : this._status;
    }

    private _doInterrupt() {
        const values = this._rootBlackboard.values;
        this._status = this._tickException ? "exception" : "interrupted";
        this._tickException = false;
        // the whole tree is aborted from the root blackboard, even if interrupted in a bound
        // callback, whose scope is kept for the rest of the callback
        const outer = this.__swapScope(this._rootBlackboard);
        try {
            if (this.root) {
                this.__abortAll(this.root);
            }
        } finally {
            this._scope = outer;
        }
        this._states.length = 0;
        for (const key in values) {
            if (Blackboard.isTempVar(key)) {
                delete values[key];
            }
        }
        this.__interrupted = false;
    }

    /**
     * @private Calls `onAbort` of every running node in the current scope, the running path may be
     * broken when interrupted.
     */
    __abortAll(node: Node) {
        for (const condition of node.conditions) {
            this.__abortAll(condition.root);
        }
        // the children of a running Scope are aborted in its overlay
        const scope = node.__isScope ? this.getState<Blackboard>(node) : undefined;
        const outer = scope ? this.__swapScope(scope) : undefined;
        try {
            for (const child of node.children) {
                this.__abortAll(child);
            }
        } finally {
            if (outer) {
                this._scope = outer;
            }
        }
        if (this.isRunning(node)) {
            try {
                node.onAbort(this);
            } catch (e) {
                node.error(`${e instanceof Error ? e.message : e}`);
            }
            this.__clearState(node);
        }
    }

    /** Calls `onClear` of every node, including the nodes of the condition trees. */
    private _clearAll(node: Node) {
        for (const condition of node.conditions) {
            this._clearAll(condition.root);
        }
        for (const child of node.children) {
            this._clearAll(child);
        }
        try {
            node.onClear(this);
        } catch (e) {
            node.error(`${e instanceof Error ? e.message : e}`);
        }
    }
}
