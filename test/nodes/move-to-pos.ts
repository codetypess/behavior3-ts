import { Node, NodeDef, Status, Tree } from "../../src/behavior3";
import { Role, RoleContext } from "../role";

export class MoveToPos extends Node {
    declare args: {
        readonly x: number;
        readonly y: number;
    };

    override onTick(tree: Tree<RoleContext, Role>): Status {
        const owner = tree.owner;
        const args = this.args;
        owner.x = args.x;
        owner.y = args.y;
        return "success";
    }

    override get descriptor(): Readonly<NodeDef> {
        return {
            name: "MoveToPos",
            type: "Action",
            desc: "移动到位置",
            args: [
                { name: "x", type: "float", desc: "x坐标" },
                { name: "y", type: "float", desc: "y坐标" },
            ],
        };
    }
}
