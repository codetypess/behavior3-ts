import { Node, NodeDef, Status, Tree } from "../../src/behavior3";
import { RoleContext } from "../role";

export class Idle extends Node {
    override onTick(tree: Tree<RoleContext, unknown>): Status {
        console.log("Do Idle");
        return "success";
    }

    static override get descriptor(): Readonly<NodeDef> {
        return {
            name: "Idle",
            type: "Action",
            desc: "待机",
        };
    }
}
