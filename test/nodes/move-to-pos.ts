import { Node, NodeDef, Process, Status } from "../../src/behavior3";
import { Position, Role, RoleTreeEnv } from "../role";

interface MoveToPosArgs {
    x: number;
    y: number;
}

export class MoveToPos extends Process {
    constructor() {
        super({
            name: "MoveToPos",
            type: "Action",
            desc: "移动到位置",
            args: [
                { name: "x", type: "float", desc: "x坐标" },
                { name: "y", type: "float", desc: "y坐标" },
            ],
        });
    }

    override tick(node: Node, env: RoleTreeEnv): Status {
        const owner = env.owner as Role;
        const args = node.args as unknown as MoveToPosArgs;
        owner.x = args.x;
        owner.y = args.y;
        return "success";
    }
}
