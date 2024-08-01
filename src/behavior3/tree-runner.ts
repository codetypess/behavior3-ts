import { Status } from "./process";
import { Tree, TreeEvent } from "./tree";
import { TreeEnv } from "./tree-env";

export type TreeStatus = Status | "interrupted";

export class TreeRunner<T extends TreeEnv> {
    protected _executing: boolean = false;
    protected _status: TreeStatus = "success";
    protected _env: T;
    protected _tree: Tree;

    constructor(env: T, tree: Tree) {
        this._env = env;
        this._tree = tree;
    }

    get env() {
        return this._env;
    }

    get tree() {
        return this._tree;
    }

    get status() {
        return this._status;
    }

    private _dispatch(event: string) {
        const env = this._env;
        env.context.dispatch(event, env);
    }

    clear() {
        // force run clear
        const interrupted = this.env.__interrupted;
        this.env.__interrupted = false;
        this._dispatch(TreeEvent.CLEANED);
        this.env.__interrupted = interrupted;

        this.interrupt();
        this._env.clear();
        this._env.context.offAll(this._env);
    }

    interrupt() {
        if (this._status === "running" || this._executing) {
            this._dispatch(TreeEvent.INTERRUPTED);
            this.env.__interrupted = true;
            if (!this._executing) {
                this._doInterrupt();
            }
        }
    }

    run(): TreeStatus {
        const env = this.env;
        const { stack } = env;

        if (env.debug) {
            console.debug(`---------------- debug ai: ${this.tree.name} --------------------`);
        }

        if (this._executing) {
            const node = stack.top();
            throw new Error(`tree '${this.tree.name}' already running: ${node?.name}#${node?.id}`);
        }

        this._executing = true;

        if (stack.length > 0) {
            let node = stack.top();
            while (node) {
                this._status = node.run(env);
                if (this._status === "running") {
                    break;
                } else {
                    node = stack.top();
                }
            }
        } else {
            this._dispatch(TreeEvent.BEFORE_RUN);
            this._status = this.tree.root.run(env);
        }

        if (this._status === "success") {
            this._dispatch(TreeEvent.AFTER_RUN);
            this._dispatch(TreeEvent.AFTER_RUN_SUCCESS);
        } else if (this._status === "failure") {
            this._dispatch(TreeEvent.AFTER_RUN);
            this._dispatch(TreeEvent.AFTER_RUN_FAILURE);
        }

        if (env.__interrupted) {
            this._doInterrupt();
        }

        this._executing = false;

        return this._status;
    }

    private _doInterrupt() {
        const env = this.env;
        const { stack, vars } = env;
        this._status = "interrupted";
        stack.clear();
        for (const key in vars) {
            if (TreeEnv.isTempVar(key)) {
                delete vars[key];
            }
        }
        env.__interrupted = false;
    }
}
