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

export const enum TreeEvent {
    CLEANED = "treeCleaned",
    INTERRUPTED = "treeInterrupted",
    /** A node throws an error while ticking, args: `(error: Error, node: Node)`. */
    ERROR = "treeError",
    BEFORE_TICKED = "treeBeforeTicked",
    AFTER_TICKED = "treeAfterTicked",
    TICKED_SUCCESS = "treeTickedSuccess",
    TICKED_FAILURE = "treeTickedFailure",
}

/**
 * The status of the tree.
 * + `interrupted`: The tree is interrupted by `tree.interrupt()`.
 * + `error`: A node throws in this tick, the tree is interrupted.
 */
export type TreeStatus = Status | "interrupted" | "error";

let treeId = 0;

/** The state of a running node which has not set its own state. */
const RUNNING = {};

export class Tree<C extends Context, Owner> {
    readonly context: C;
    readonly path: string;
    readonly blackboard: Blackboard;
    readonly id: number = ++treeId;

    debug: boolean = false;

    protected _ticking: boolean = false;
    protected _owner: Owner;

    /** @private */
    __runningNode: Node | undefined = undefined;

    /** @private */
    __interrupted: boolean = false;

    private _root?: Node;
    private _status: TreeStatus = "success";
    private _states: unknown[] = [];
    private _tickError: boolean = false;
    private _callback?: { interrupt: boolean };
    /** The tick count when the node is ticked last time, only recorded in debug mode. */
    private _ticked: number[] = [];
    private _tickCount: number = 0;

    constructor(context: C, owner: Owner, path: string) {
        this.context = context;
        this.path = path;
        this.blackboard = new Blackboard(this);
        this.context.loadTree(this.path);
        this._owner = owner;
    }

    get owner() {
        return this._owner;
    }

    get root(): Node | undefined {
        return (this._root ||= this.context.trees[this.path]);
    }

    get ready() {
        return !!this.root;
    }

    get status() {
        return this._status;
    }

    get ticking() {
        return this._ticking;
    }

    get runningNode() {
        return this.__runningNode;
    }

    clear() {
        // force run clear
        const interrupted = this.__interrupted;
        this.__interrupted = false;
        this.context.dispatch(TreeEvent.CLEANED, this);
        this.__interrupted = interrupted;

        this.interrupt();
        this.debug = false;
        this.__interrupted = false;
        this._status = "success";
        this._states.length = 0;
        this.blackboard.clear();
        this.context.offAll(this);
    }

    interrupt() {
        if (this._status === "running" || this._ticking) {
            this.context.dispatch(TreeEvent.INTERRUPTED, this);
            this.__interrupted = true;
            if (this._callback) {
                this._callback.interrupt = true;
            } else if (!this._ticking) {
                this._doInterrupt();
            }
        }
    }

    /**
     * @private Ticks the node in an async callback (like `Listen` and `Delay`), which is
     * independent of `tick`. An error only stops this subtree without interrupting the tree,
     * and the running nodes left in the subtree are aborted.
     */
    __tickInCallback(node: Node) {
        const outer = this._callback;
        const interrupted = this.__interrupted;
        const runningNode = this.__runningNode;
        const callback = (this._callback = { interrupt: false });
        this.__interrupted = false;

        node.tick(this);

        this._abortAll(node);
        this._callback = outer;
        this.__runningNode = runningNode;
        this.__interrupted = interrupted || callback.interrupt;
        if (callback.interrupt) {
            if (outer) {
                outer.interrupt = true;
            } else if (!this._ticking) {
                this._doInterrupt();
            }
        }
    }

    /** @private Called when a node throws, dispatches `ERROR` and stops the tick. */
    __error(node: Node, error: Error) {
        this.context.dispatch(TreeEvent.ERROR, this, error, node);
        if (this._callback) {
            // only stops the subtree of the callback
            this.__interrupted = true;
        } else {
            this._tickError = true;
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
            return "failure";
        }

        if (this.debug) {
            console.debug(`---------------- debug ai: ${this.path} --------------------`);
        }

        if (this._ticking) {
            const node = this.__runningNode;
            throw new Error(`tree '${this.path}' already ticking: ${node?.name}#${node?.id}`);
        }

        this._ticking = true;
        this._tickError = false;

        if (!this.isRunning(root)) {
            context.dispatch(TreeEvent.BEFORE_TICKED, this);
        }

        const status: Status = root.tick(this);

        if (status === "success") {
            this.__runningNode = undefined;
            this._status = "success";
            context.dispatch(TreeEvent.AFTER_TICKED, this);
            context.dispatch(TreeEvent.TICKED_SUCCESS, this);
        } else if (status === "failure") {
            this._status = "failure";
            this.__runningNode = undefined;
            context.dispatch(TreeEvent.AFTER_TICKED, this);
            context.dispatch(TreeEvent.TICKED_FAILURE, this);
        } else {
            this._status = "running";
        }

        if (this.__interrupted) {
            this._doInterrupt();
        } else if (this.debug) {
            this._checkMissingAbort(root);
        }

        this._tickCount++;
        this._ticking = false;

        return this._status;
    }

    private _doInterrupt() {
        const values = this.blackboard.values;
        this._status = this._tickError ? "error" : "interrupted";
        this._tickError = false;
        if (this.root) {
            this._abortAll(this.root);
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
     * Calls `onAbort` of every running node, the running path may be broken when interrupted.
     */
    private _abortAll(node: Node) {
        for (const condition of node.conditions) {
            this._abortAll(condition.root);
        }
        for (const child of node.children) {
            this._abortAll(child);
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
}
