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

    clear() {
        this.env.clear();
    }

    interrupt() {
        if (this._status === "running") {
            this.tree.dispatch(TreeEvent.INTERRUPTED);
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
                let node = stack.at(-1);
                while (node) {
                    this._status = node.run(env);
                    if (this._status === "running") {
                        break;
                    } else {
                        node = stack.at(-1);
                    }
                }
            } else {
                this.tree.dispatch(TreeEvent.BEFORE_RUN);
                this._status = this.tree.root.run(env);
            }
            if (this._status === "success") {
                this.tree.dispatch(TreeEvent.AFTER_RUN);
                this.tree.dispatch(TreeEvent.AFTER_RUN_SUCCESS);
            } else if (this._status === "failure") {
                this.tree.dispatch(TreeEvent.AFTER_RUN);
                this.tree.dispatch(TreeEvent.AFTER_RUN_FAILURE);
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
