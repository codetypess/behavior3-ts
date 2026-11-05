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

/**
 * @private The nodes ticked together by `tick` or by a callback (`__tickInCallback`), which stop
 * together. The callbacks from `bindCallback`, the abort and the clear run in the current one.
 */
export type StopScope = {
    /** The nodes of the scope stop: each returns `running` right away. */
    stopped: boolean;
    /**
     * Stopped because the tree is interrupted or cleared, not only because a node of this callback
     * threw: the tree is aborted when the outermost scope exits.
     */
    interrupted: boolean;
    readonly outer: StopScope | undefined;
};

export class Tree<C extends Context, Owner> {
    readonly context: C;
    readonly path: string;
    readonly id: number = ++treeId;

    debug: boolean = false;

    protected _ticking: boolean = false;
    protected _owner: Owner;

    /**
     * @private The last node whose tick started (not necessarily a running one), named in the
     * error of ticking the tree while it's ticking.
     */
    __runningNode: Node | undefined = undefined;

    /** @private The current stop scope, read by the nodes while ticking. */
    __stopScope: StopScope;

    private _root?: Node;
    private readonly _rootBlackboard: Blackboard;
    /** The current scope, switched by `Scope` nodes and condition trees while ticking. */
    private _scope: Blackboard;
    private _status: TreeStatus = "success";
    private _states: unknown[] = [];
    private _tickException: boolean = false;
    /** The scope out of any tick or callback, never stopped. */
    private readonly _idleScope: StopScope = { stopped: false, interrupted: false, outer: undefined };
    /** The scope of `tick`, reused: the tree is ticked only out of any execution. */
    private readonly _tickScope: StopScope = {
        stopped: false,
        interrupted: false,
        outer: this._idleScope,
    };
    /**
     * How many executions are on the stack: `tick`, `__tickInCallback`, the callbacks from
     * `bindCallback`, `interrupt` aborting the nodes and `clear`. A `clear` while executing waits
     * until it is back to 0.
     */
    private _executing: number = 0;
    /** `clear` is called while executing, the tree is cleared when the execution exits. */
    private _pendingClear: boolean = false;
    /** `clear` is running, a `clear` from its listeners is ignored. */
    private _clearing: boolean = false;
    /**
     * Interrupted and the running nodes not aborted yet: set before `INTERRUPTED` is dispatched,
     * another `interrupt` meanwhile (like from its listeners or `onAbort`) does nothing.
     */
    private _interrupting: boolean = false;
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
        this.__stopScope = this._idleScope;
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
     * `Delay`), running a callback from `bindCallback`, aborting its running nodes when
     * interrupted outside the tick, or clearing. It can't be ticked meanwhile.
     */
    get executing() {
        return this._executing > 0;
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
            this._stopAll();
            return;
        }
        this._doClear();
    }

    /**
     * Clears the tree from the root blackboard, the whole tree is cleared in it. An execution: the
     * tree can't be ticked by its listeners, `onAbort` or `onClear`.
     */
    private _doClear() {
        this._pendingClear = false;
        this._clearing = true;
        this._executing++;
        const outer = this.__swapScope(this._rootBlackboard);
        try {
            // out of any tick or callback: the children of Listen(CLEANED) run in their own scope
            this.context.__dispatchIsolated(this.path, TreeEvent.CLEANED, this);

            if (this._interrupting) {
                // interrupted while executing, the abort was left to this clear: INTERRUPTED has
                // been dispatched
                this._doInterrupt();
            } else {
                this.interrupt();
            }
            if (this.root) {
                // after the running nodes are aborted, before the private vars are cleared
                this._clearAll(this.root);
            }
            this.debug = false;
            this._interrupting = false;
            this._status = "success";
            this._states.length = 0;
            this._rootBlackboard.clear();
            this.context.offAll(this);
            // after CLEANED and INTERRUPTED, whose listeners still run
            this._clearCount++;
        } finally {
            this._scope = outer;
            this._clearing = false;
            // a `clear` meanwhile is ignored, nothing is pending
            this._executing--;
        }
    }

    /**
     * Stops the nodes of the current scope and the outer ones: the tree is interrupted or cleared.
     */
    private _stopAll() {
        for (let scope = this.__stopScope; scope !== this._idleScope; scope = scope.outer!) {
            scope.stopped = true;
            scope.interrupted = true;
        }
    }

    /** Leaves an execution, clears the tree if `clear` was called in the outermost one. */
    private _exitExecution() {
        if (--this._executing === 0 && this._pendingClear) {
            this._doClear();
        }
    }

    /**
     * Interrupts the tree: dispatches `INTERRUPTED` and aborts the running nodes, right away when
     * the tree is idle, otherwise when the tick or the callback exits. Once per interruption: an
     * `interrupt` before the nodes are aborted does nothing.
     */
    interrupt() {
        if (this._interrupting) {
            return;
        } else if (this._status === "running" || this._ticking) {
            this._interrupting = true;
            this.context.__dispatchIsolated(this.path, TreeEvent.INTERRUPTED, this);
            if (this.__stopScope !== this._idleScope) {
                // aborted when the outermost scope exits
                this._stopAll();
            } else {
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
        const runningNode = this.__runningNode;
        const outer = this.__stopScope;
        const stop: StopScope = { stopped: false, interrupted: false, outer };
        this.__stopScope = stop;

        const outerScope = this.__swapScope(scope);
        this._executing++;
        try {
            try {
                if (node.tick(this) === "running") {
                    // nobody ticks the subtree again: abort the nodes left running, also when
                    // stopped halfway (a finished node has aborted its children)
                    this.__abortAll(node);
                }
            } finally {
                this._scope = outerScope;
                this.__stopScope = outer;
            }

            this.__runningNode = runningNode;
            if (stop.interrupted && outer === this._idleScope && !this._pendingClear) {
                // the outermost scope: aborted now (in a tick or an outer callback, it is stopped
                // too and aborts when it exits; a clear aborts when the outermost execution exits)
                this._doInterrupt();
            }
        } finally {
            this._exitExecution();
        }
    }

    /** @private Called when a node throws, dispatches `EXCEPTION` and stops the tick. */
    __exception(node: Node, error: Error) {
        this.context.__dispatchIsolated(this.path, TreeEvent.EXCEPTION, this, error, node);
        const scope = this.__stopScope;
        if (scope !== this._tickScope && scope !== this._idleScope) {
            // only stops the subtree of the callback
            scope.stopped = true;
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
            // like ticking it in a node: the nodes of the callback (or being aborted, cleared) are
            // on the stack, and the tick would run the whole tree in the middle of it (like a
            // callback of a subtree ticking the caller, which runs the subtree again by `RunTree`)
            throw new Error(
                `tree '${this.path}' is executing (a callback, an abort or a clear), it can't be ` +
                    `ticked until it returns`,
            );
        }

        this._ticking = true;
        this._tickException = false;
        const tickScope = this._tickScope;
        tickScope.stopped = false;
        tickScope.interrupted = false;
        this.__stopScope = tickScope;
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
            } else if (tickScope.stopped) {
                this._doInterrupt();
            } else if (this.debug) {
                this._checkMissingAbort(root);
            }

            this._tickCount++;
        } finally {
            // stopped by a clear, done below when the execution exits
            cleared = this._pendingClear;
            this._scope = outerScope;
            this.__stopScope = this._idleScope;
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
        this._interrupting = false;
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
