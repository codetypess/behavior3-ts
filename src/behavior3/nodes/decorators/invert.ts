import { type Context } from "../../context";
import { Node, NodeDef, Status } from "../../node";
import { registerNode } from "../../register-node";
import { Tree } from "../../tree";

@registerNode
export class Invert extends Node {
    override onTick(tree: Tree<Context, unknown>): Status {
        const status = this.children[0].tick(tree);
        if (status === "running" || status === "error") {
            return status;
        }
        return status === "failure" ? "success" : "failure";
    }

    static override get descriptor(): NodeDef {
        return {
            name: "Invert",
            type: "Decorator",
            group: ["Core"],
            children: 1,
            status: ["!success", "!failure", "|running"],
            desc: "反转子节点运行结果",
            doc: `
                + 只能有一个子节点，多个仅执行第一个
                + 当子节点返回 \`success\` 时返回 \`failure\`
                + 当子节点返回 \`failure\` 时返回 \`success\`
                + 当子节点返回 \`running\` 或 \`error\` 时原样返回，\`error\` 不会被反转
            `,
        };
    }
}
