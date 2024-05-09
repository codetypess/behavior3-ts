import { Node, NodeDef } from "../../node";
import { Process, Status } from "../../process";
import { TreeEnv } from "../../tree-env";

export class Not extends Process {
    override init(node: Node): void {
        if (node.children.length == 0) {
            node.error(`at least one children`);
        }
    }

    override run(node: Node, env: TreeEnv): Status {
        const isYield = node.resume(env);
        if (typeof isYield === "boolean") {
            if (env.status === "running") {
                return "running";
            } else {
                return this._retNot(env.status);
            }
        }
        const status = node.children[0].run(env);
        if (status === "running") {
            return node.yield(env);
        }
        return this._retNot(status);
    }

    private _retNot(status: Status): Status {
        return status === "failure" ? "success" : "failure";
    }

    override get descriptor(): NodeDef {
        return {
            name: "Not",
            type: "Decorator",
            desc: "取反",
            doc: `
                + 将子节点的返回值取反`,
        };
    }
}
