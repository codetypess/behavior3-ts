import type { Context } from "../../context";
import { Node, NodeDef, Status } from "../../node";
import { Tree } from "../../tree";

export class AlwaysRunning extends Node {
    override onTick(tree: Tree<Context, unknown>, status: Status): Status {
        this.children[0].tick(tree);
        return "running";
    }

    static override get descriptor(): NodeDef {
        return {
            name: "AlwaysRunning",
            type: "Decorator",
            children: 1,
            status: ["running"],
            desc: "始终返回运行中状态",
            doc: `
                + 只能有一个子节点，多个仅执行第一个
                + 始终返回 \`running\`
            `,
        };
    }
}
