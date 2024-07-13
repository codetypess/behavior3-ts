import { Callback } from "./context";
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

    private _dispatch(event: string, ...args: unknown[]) {
        const env = this._env;
        env.context.dispatchTarget(env, event, ...args);
    }

    clear() {
        this.interrupt();
        this._env.clear();
        this._env.context.offAll(this._env);
    }

    interrupt() {
        if (this._status === "running") {
            this._dispatch(TreeEvent.INTERRUPTED);
            this.env.__interrupted = true;
            if (!this._executing) {
                this.run();
            }
        }
    }

    run(): TreeStatus {
        const env = this.env;
        const { stack, vars } = env;

        if (env.debug) {
            console.debug(`---------------- debug ai: ${this.tree.name} --------------------`);
        }

        this._executing = true;

        if (!env.__interrupted) {
            if (stack.length > 0) {
                let node = stack[stack.length - 1];
                while (node) {
                    this._status = node.run(env);
                    if (this._status === "running") {
                        break;
                    } else {
                        node = stack[stack.length - 1];
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
        }

        if (env.__interrupted) {
            this._status = "interrupted";
            stack.length = 0;
            for (const key in vars) {
                if (TreeEnv.isTempVar(key)) {
                    delete vars[key];
                }
            }
            env.__interrupted = false;
        }

        this._executing = false;

        return this._status;
    }
}
