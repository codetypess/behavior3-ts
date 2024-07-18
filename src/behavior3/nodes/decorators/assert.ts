import { Node, NodeDef } from "../../node";
import { Process, Status } from "../../process";
import { TreeEnv } from "../../tree-env";

interface NodeArgs {
    message: string;
}

export class Assert extends Process {
    override init(node: Node): void {
        this._checkOneChild(node);
    }

    override run(node: Node, env: TreeEnv): Status {
        const args = node.args as unknown as NodeArgs;
        const isYield = node.resume(env);
        if (typeof isYield === "boolean") {
            if (env.status === "running") {
                node.error(`unexpected status error`);
            }

            if (env.status === "success") {
                return "success";
            } else {
                throw new Error(args.message);
            }
        }

        const status = node.children[0].run(env);
        if (status === "success") {
            return "success";
        } else if (status === "running") {
            return node.yield(env);
        } else {
            throw new Error(args.message);
        }
    }

    override get descriptor(): NodeDef {
        return {
            name: "Assert",
            type: "Decorator",
            children: 1,
            status: ["success"],
            desc: "断言",
            args: [
                {
                    name: "message",
                    type: "string",
                    desc: "消息",
                },
            ],
            doc: `
                + 只能有一个子节点，多个仅执行第一个
                + 当子节点返回\`失败\`时，抛出异常
                + 其余情况返回子节点的执行状态
            `,
        };
    }
}
