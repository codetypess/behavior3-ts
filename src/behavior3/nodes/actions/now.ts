import { type Context } from "../../context";
import { Node, NodeDef, Status } from "../../node";
import { registerNode } from "../../register-node";
import { Tree } from "../../tree";

@registerNode
export class Now extends Node {
    override onTick(tree: Tree<Context, unknown>, status: Status): Status {
        this.output.push(tree.context.time);
        return "success";
    }

    static override get descriptor(): NodeDef {
        return {
            name: "Now",
            type: "Action",
            children: 0,
            status: ["success"],
            desc: "获取当前时间",
            output: ["当前时间"],
        };
    }
}
