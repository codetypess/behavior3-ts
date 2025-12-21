import type { Context } from "../../context";
import { Node, NodeDef, Status } from "../../node";
import { Tree } from "../../tree";

export class JustFailure extends Node {
    override onTick(tree: Tree<Context, unknown>, status: Status): Status {
        return "failure";
    }

    static override get descriptor(): NodeDef {
        return {
            name: "JustFailure",
            type: "Action",
            children: 0,
            status: ["failure"],
            desc: "什么都不干，只返回失败",
        };
    }
}
