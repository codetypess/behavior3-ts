import { type Context } from "../../context";
import { Node, NodeDef, Status } from "../../node";
import { registerNode } from "../../register-node";
import { Tree } from "../../tree";

// 只返回成功，用来满足一些特殊节点的结构要求
@registerNode
export class JustSuccess extends Node {
    override onTick(tree: Tree<Context, unknown>): Status {
        return "success";
    }

    static override get descriptor(): NodeDef {
        return {
            name: "JustSuccess",
            type: "Action",
            group: ["Core"],
            children: 0,
            status: ["success"],
            desc: "不做任何事，直接返回成功",
            doc: `
                + 常用作占位，满足节点对子节点数量的要求，比如 \`IfElse\` 的空分支
            `,
        };
    }
}
