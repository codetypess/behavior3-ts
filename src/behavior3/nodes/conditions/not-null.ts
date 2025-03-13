import type { Context } from "../../context";
import { Node, NodeDef, Status } from "../../node";
import { Tree } from "../../tree";

export class NotNull extends Node {
    declare input: [unknown];

    override onTick(tree: Tree<Context, unknown>, status: Status): Status {
        const [value] = this.input;
        if (value === undefined || value === null) {
            return "failure";
        } else {
            return "success";
        }
    }

    static override get descriptor(): NodeDef {
        return {
            name: "NotNull",
            type: "Condition",
            children: 0,
            status: ["success", "failure"],
            desc: "判断变量是否存在",
            input: ["判断的变量"],
        };
    }
}
