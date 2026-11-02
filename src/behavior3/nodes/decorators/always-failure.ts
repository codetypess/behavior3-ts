import { type Context } from "../../context";
import { Node, NodeDef, Status } from "../../node";
import { registerNode } from "../../register-node";
import { Tree } from "../../tree";

@registerNode
export class AlwaysFailure extends Node {
    override onTick(tree: Tree<Context, unknown>): Status {
        const status = this.children[0].tick(tree);
        return status === "running" || status === "error" ? status : "failure";
    }

    static override get descriptor(): NodeDef {
        return {
            name: "AlwaysFailure",
            type: "Decorator",
            group: ["Core"],
            children: 1,
            status: ["failure", "|running"],
            desc: "始终返回失败",
            doc: `
                + 只能有一个子节点，多个仅执行第一个
                + 当子节点返回 \`running\` 时，返回 \`running\`
                + 当子节点返回 \`error\` 时，返回 \`error\`：数据不可信，不能当成失败；要忽略 \`error\`，在子节点外面先包一层 \`ErrorToFailure\`
                + 子节点返回 \`success\` 或 \`failure\` 时，都返回 \`failure\`
            `,
        };
    }
}
