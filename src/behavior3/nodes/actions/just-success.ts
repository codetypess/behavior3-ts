import type { Context } from "../../context";
import { Node, NodeDef, Status } from "../../node";
import { Tree } from "../../tree";

// 只返回成功，用来满足一些特殊节点的结构要求
export class JustSuccess extends Node {
    override onTick(tree: Tree<Context, unknown>, status: Status): Status {
        return "success";
    }

    static override get descriptor(): NodeDef {
        return {
            name: "JustSuccess",
            type: "Action",
            children: 0,
            status: ["success"],
            desc: "什么都不干，只返回成功",
        };
    }
}
