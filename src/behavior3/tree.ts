import { Blackboard } from "./blackboard";
import { Context } from "./context";
import { Node, NodeData, Status } from "./node";
import { Stack } from "./stack";

export interface TreeData {
    readonly name: string;
    readonly desc: string;
    readonly root: NodeData;
    readonly group: string[];
}

export const enum TreeEvent {
    CLEANED = "treeCleaned",
    INTERRUPTED = "treeInterrupted",
    BEFORE_TICKED = "treeBeforeTicked",
    AFTER_TICKED = "treeAfterTicked",
    TICKED_SUCCESS = "treeTickedSuccess",
    TICKED_FAILURE = "treeTickedFailure",
}

export type TreeStatus = Exclude<Status, "error"> | "interrupted";

let treeId = 0;

export class Tree<C extends Context, Owner> {
    readonly context: C;
    readonly path: string;
    readonly blackboard: Blackboard;
    readonly stack: Stack;
    readonly id: number = ++treeId;

    debug: boolean = false;

    protected _ticking: boolean = false;
    protected _owner: Owner;

    /** @private */
    __lastStatus: Status = "success";

    /** @private */
    __interrupted: boolean = false;

    private _root?: Node;
    private _status: TreeStatus = "success";

    constructor(context: C, owner: Owner, path: string) {
        this.context = context;
        this.path = path;
        this.blackboard = new Blackboard(this);
        this.stack = new Stack(this);
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
        this.stack.clear();
        this.blackboard.clear();
        this.context.offAll(this);
    }

    interrupt() {
        if (this._status === "running" || this._ticking) {
            this.context.dispatch(TreeEvent.INTERRUPTED, this);
            this.__interrupted = true;
            if (!this._ticking) {
                this._doInterrupt();
            }
        }
    }

    yield<V = unknown>(node: Node, value?: V): Status {
        this.blackboard.set(node.__yield, value ?? true);
        return "running";
    }

    resume<V = unknown>(node: Node): V | undefined {
        return this.blackboard.get(node.__yield) as V;
    }

    tick(): TreeStatus {
        const { context, stack, root } = this;

        if (!root) {
            return "failure";
        }

        if (this.debug) {
            console.debug(`---------------- debug ai: ${this.path} --------------------`);
        }

        if (this._ticking) {
            const node = stack.top();
            throw new Error(`tree '${this.path}' already ticking: ${node?.name}#${node?.id}`);
        }

        this._ticking = true;

        let status: Status = "failure";

        if (stack.length > 0) {
            let node = stack.top();
            while (node) {
                status = node.tick(this);
                if (status === "running") {
                    break;
                } else {
                    node = stack.top();
                }
            }
        } else {
            context.dispatch(TreeEvent.BEFORE_TICKED, this);
            status = root.tick(this);
        }

        if (status === "success") {
            this._status = "success";
            context.dispatch(TreeEvent.AFTER_TICKED, this);
            context.dispatch(TreeEvent.TICKED_SUCCESS, this);
        } else if (status === "failure" || status === "error") {
            this._status = "failure";
            context.dispatch(TreeEvent.AFTER_TICKED, this);
            context.dispatch(TreeEvent.TICKED_FAILURE, this);
        } else {
            this._status = "running";
        }

        if (this.__interrupted) {
            this._doInterrupt();
        }

        this._ticking = false;

        return this._status;
    }

    private _doInterrupt() {
        const values = this.blackboard.values;
        this._status = "interrupted";
        this.stack.clear();
        for (const key in values) {
            if (Blackboard.isTempVar(key)) {
                delete values[key];
            }
        }
        this.__interrupted = false;
    }
}
