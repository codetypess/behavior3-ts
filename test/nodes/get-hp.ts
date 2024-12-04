import { Node, NodeDef, Process, Status } from "../../src/behavior3";
import { Role, RoleTreeEnv } from "../role";

export class GetHp extends Process {
    constructor() {
        super({
            name: "GetHp",
            type: "Action",
            desc: "获取生命值",
            output: ["hp"],
        });
    }

    override tick(node: Node, env: RoleTreeEnv): Status {
        env.output.push((env.owner as Role).hp);
        return "success";
    }
}
