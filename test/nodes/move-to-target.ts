import { Node, NodeDef, Process, Status } from "../../src/behavior3";
import { Role, RoleTreeEnv } from "../role";

type MoveToTargetInput = [Role | undefined];

export class MoveToTarget extends Process {
    static SPEED = 50;

    override tick(node: Node, env: RoleTreeEnv): Status {
        const [target] = env.input as MoveToTargetInput;
        if (!target) {
            return "failure";
        }
        const owner = env.owner as Role;
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

        return node.yield(env);
    }

    get descriptor(): NodeDef {
        return { name: "MoveToTarget", type: "Action", desc: "移动到目标", input: ["目标"] };
    }
}
