import { type Context } from "../../context";
import { Node, NodeDef, Status } from "../../node";
import { registerNode } from "../../register-node";
import { Tree } from "../../tree";

@registerNode
export class AlwaysRunning extends Node {
    override onTick(tree: Tree<Context, unknown>): Status {
        const status = this.children[0].tick(tree);
        return status === "error" ? "error" : "running";
    }

    static override get descriptor(): NodeDef {
        return {
            name: "AlwaysRunning",
            type: "Decorator",
            group: ["Core"],
            children: 1,
            status: ["running"],
            desc: "始终返回运行中状态",
            doc: `
                + 只能有一个子节点，多个仅执行第一个
                + 子节点返回 \`error\` 时返回 \`error\`，其它情况都返回 \`running\`
            `,
        };
    }
}
