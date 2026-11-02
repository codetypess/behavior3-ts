import { type Context } from "../../context";
import { Node, NodeDef, Status } from "../../node";
import { registerNode } from "../../register-node";
import { Tree } from "../../tree";

@registerNode
export class AlwaysSuccess extends Node {
    override onTick(tree: Tree<Context, unknown>): Status {
        const status = this.children[0].tick(tree);
        return status === "running" || status === "error" ? status : "success";
    }

    static override get descriptor(): NodeDef {
        return {
            name: "AlwaysSuccess",
            type: "Decorator",
            children: 1,
            status: ["success", "|running"],
            desc: "始终返回成功",
            doc: `
                + 只能有一个子节点，多个仅执行第一个
                + 当子节点返回 \`running\` 时，返回 \`running\`
                + 当子节点返回 \`error\` 时，返回 \`error\`：数据不可信，不能当成成功；要忽略 \`error\`，在子节点外面先包一层 \`ErrorToFailure\`
                + 子节点返回 \`success\` 或 \`failure\` 时，都返回 \`success\`
            `,
        };
    }
}
