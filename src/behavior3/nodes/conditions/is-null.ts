import type { Context, DeepReadonly } from "../../context";
import { Node, NodeDef, Status } from "../../node";
import { Tree } from "../../tree";

export class IsNull extends Node {
    declare input: [unknown];

    override onTick(tree: Tree<Context, unknown>): Status {
        const [value] = this.input;
        if (value === undefined || value === null) {
            return "success";
        } else {
            return "failure";
        }
    }

    get descriptor(): DeepReadonly<NodeDef> {
        return {
            name: "IsNull",
            type: "Condition",
            children: 0,
            status: ["success", "failure"],
            desc: "判断变量是否不存在",
            input: ["判断的变量"],
        };
    }
}
