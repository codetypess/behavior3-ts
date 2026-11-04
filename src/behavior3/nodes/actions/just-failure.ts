import { type Context } from "../../context";
import { Node, NodeDef, Status } from "../../node";
import { registerNode } from "../../register-node";
import { Tree } from "../../tree";

@registerNode
export class JustFailure extends Node {
    override onTick(tree: Tree<Context, unknown>): Status {
        return "failure";
    }

    static override get descriptor(): NodeDef {
        return {
            name: "JustFailure",
            type: "Action",
            group: ["Core"],
            children: 0,
            status: ["failure"],
            desc: "不做任何事，直接返回失败",
        };
    }
}
