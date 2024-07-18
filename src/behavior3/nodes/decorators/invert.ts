import { Node, NodeDef } from "../../node";
import { Process, Status } from "../../process";
import { TreeEnv } from "../../tree-env";

export class Invert extends Process {
    override init(node: Node): void {
        this._checkOneChild(node);
    }

    override run(node: Node, env: TreeEnv): Status {
        const isYield = node.resume(env);
        if (typeof isYield === "boolean") {
            if (env.status === "running") {
                node.error(`unexpected status error`);
            }
            return this._invert(env.status);
        }
        const status = node.children[0].run(env);
        if (status === "running") {
            return node.yield(env);
        }
        return this._invert(status);
    }

    private _invert(status: Status): Status {
        return status === "failure" ? "success" : "failure";
    }

    override get descriptor(): NodeDef {
        return {
            name: "Invert",
            type: "Decorator",
            children: 1,
            status: ["!success", "!failure", "|running"],
            desc: "反转子节点运行结果",
            doc: `
                + 只能有一个子节点，多个仅执行第一个
                + 当子节点返回\`成功\`时返回\`失败\`
                + 当子节点返回\`失败\`时返回\`成功\`
            `,
        };
    }
}
