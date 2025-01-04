import { Context, Node, NodeDef, Status, Tree } from "../../src/behavior3";
import { Role } from "../role";

export class MoveToTarget extends Node {
    static SPEED = 50;

    declare input: [Role | undefined];

    override onTick(tree: Tree<Context, Role>): Status {
        const owner = tree.owner;
        const [target] = this.input;
        if (!target) {
            return "failure";
        }
        const { x, y } = owner;
        const { x: tx, y: ty } = target;
        if (Math.abs(x - tx) < MoveToTarget.SPEED && Math.abs(y - ty) < MoveToTarget.SPEED) {
            console.log("Moving reach target");
            return "success";
        }

        console.log(`Moving (${x}, ${y}) => (${tx}, ${ty})`);

        if (Math.abs(x - tx) >= MoveToTarget.SPEED) {
            owner.x = owner.x + MoveToTarget.SPEED * (tx > x ? 1 : -1);
        }

        if (Math.abs(y - ty) >= MoveToTarget.SPEED) {
            owner.y = owner.y + MoveToTarget.SPEED * (ty > x ? 1 : -1);
        }

        return tree.yield(this);
    }

    get descriptor(): Readonly<NodeDef> {
        return {
            name: "MoveToTarget",
            type: "Action",
            desc: "移动到目标",
            input: ["目标"],
        };
    }
}
