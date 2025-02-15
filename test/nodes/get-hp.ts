import { Context, Node, NodeDef, Status, Tree } from "../../src/behavior3";
import { Role } from "../role";

export class GetHp extends Node {
    override onTick(tree: Tree<Context, Role>): Status {
        const owner = tree.owner;
        this.output.push(owner.hp);
        return "success";
    }

    static override get descriptor(): Readonly<NodeDef> {
        return {
            name: "GetHp",
            type: "Action",
            desc: "获取生命值",
            output: ["hp"],
        };
    }
}
