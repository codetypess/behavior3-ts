import { Blackboard } from "./blackboard";
import { Context } from "./context";
import { Node, NodeData, Status } from "./node";
import { Stack } from "./stack";

export interface TreeData {
    readonly name: string;
    readonly desc: string;
    readonly root: NodeData;
}

export const enum TreeEvent {
    CLEANED = "treeCleaned",
    INTERRUPTED = "treeInterrupted",
    BEFORE_TICKED = "treeBeforeTicked",
    AFTER_TICKED = "treeAfterTicked",
    TICKED_SUCCESS = "treeTickedSuccess",
    TICKED_FAILURE = "treeTickedFailure",
}

export class Tree<C extends Context, Owner> {
    readonly context: C;
    readonly owner: Owner;
    readonly path: string;
    readonly blackboard: Blackboard;
    readonly stack: Stack;

    debug: boolean = false;

    protected _ticking: boolean = false;

    private _root?: Node;

    /** @private */
    __status: Status = "success";

    /** @private */
    __interrupted: boolean = false;

    constructor(context: C, owner: Owner, path: string) {
        this.context = context;
        this.owner = owner;
        this.path = path;
        this.blackboard = new Blackboard(this);
        this.stack = new Stack(this);
        this._loadTree();
    }

    get root() {
        return this._root;
    }

    get status() {
        return this.__status;
    }

    get ticking() {
        return this._ticking;
    }

    private async _loadTree() {
        this._root = this.context.trees[this.path];
        if (!this._root) {
            this._root = await this.context.loadTree(this.path);
        }
    }

    private _dispatch(event: string) {
        this.context.dispatch(event, this);
    }

    clear() {
        // force run clear
        const interrupted = this.__interrupted;
        this.__interrupted = false;
        this._dispatch(TreeEvent.CLEANED);
        this.__interrupted = interrupted;

        this.interrupt();
        this.debug = false;
        this.__interrupted = false;
        this.__status = "success";
        this.stack.clear();
        this.blackboard.clear();
        this.context.offAll(this);
    }

    interrupt() {
        if (this.__status === "running" || this._ticking) {
            this._dispatch(TreeEvent.INTERRUPTED);
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

    tick(): Status {
        const { stack, root } = this;

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

        if (stack.length > 0) {
            let node = stack.top();
            while (node) {
                this.__status = node.tick(this);
                if (this.__status === "running") {
                    break;
                } else {
                    node = stack.top();
                }
            }
        } else {
            this._dispatch(TreeEvent.BEFORE_TICKED);
            this.__status = root.tick(this);
        }

        if (this.__status === "success") {
            this._dispatch(TreeEvent.AFTER_TICKED);
            this._dispatch(TreeEvent.TICKED_SUCCESS);
        } else if (this.__status === "failure") {
            this._dispatch(TreeEvent.AFTER_TICKED);
            this._dispatch(TreeEvent.TICKED_FAILURE);
        }

        if (this.__interrupted) {
            this._doInterrupt();
        }

        this._ticking = false;

        return this.__status;
    }

    private _doInterrupt() {
        const values = this.blackboard.values;
        this.__status = "failure";
        this.stack.clear();
        for (const key in values) {
            if (Blackboard.isTempVar(key)) {
                delete values[key];
            }
        }
        this.__interrupted = false;
    }
}
