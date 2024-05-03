import { Status } from "./process";
import { Tree } from "./tree";
import { TreeEnv } from "./tree-env";

export type TreeStatus = Status | "interrupted";

export class TreeRunner<T extends TreeEnv> {
    private _executing: boolean = false;
    private _status: TreeStatus = "success";

    constructor(readonly env: T, readonly tree: Tree) {}

    get running() {
        return this.env.stack.length > 0;
    }

    get status() {
        return this._status;
    }

    clear() {
        this.env.clear();
    }

    interrupt() {
        this.env.__privateInterrupted = true;
        if (!this._executing) {
            this.run();
        }
    }

    run(): TreeStatus {
        const env = this.env;
        const { stack, vars } = env;

        if (env.debug) {
            console.debug(`---------------- debug ai: ${this.tree.name} --------------------`);
        }

        this._executing = true;

        if (!env.__privateInterrupted) {
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
                this._status = this.tree.root.run(env);
            }
        }

        if (env.__privateInterrupted) {
            this._status = "interrupted";
            stack.length = 0;
            for (const key in vars) {
                if (TreeEnv.isTempVar(key)) {
                    delete vars[key];
                }
            }
            env.__privateInterrupted = false;
        }

        this._executing = false;

        return this._status;
    }
}
