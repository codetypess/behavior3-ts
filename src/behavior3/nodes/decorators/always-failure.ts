import { Node, NodeDef } from "../../node";
import { Process, Status } from "../../process";
import { TreeEnv } from "../../tree-env";

export class AlwaysFail extends Process {
    override tick(node: Node, env: TreeEnv): Status {
        const isYield = node.resume(env);
        if (typeof isYield === "boolean") {
            if (env.status === "running") {
                node.error(`unexpected status error`);
            }
            return "failure";
        }
        const status = node.children[0].tick(env);
        if (status === "running") {
            return node.yield(env);
        }
        return "failure";
    }

    override get descriptor(): NodeDef {
        return {
            name: "AlwaysFail",
            type: "Decorator",
            children: 1,
            status: ["failure", "|running"],
            desc: "始终返回失败",
            doc: `
                + 只能有一个子节点，多个仅执行第一个
                + 不管子节点是否成功都返回 \`failure\`
            `,
        };
    }
}
