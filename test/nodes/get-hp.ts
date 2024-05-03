import { Node, NodeDef, Process, Status } from "../../src/behavior3";
import { Role, RoleTreeEnv } from "../role";

export class GetHp extends Process {
    override run(node: Node, env: RoleTreeEnv): Status {
        env.output.push((env.owner as Role).hp);
        return "success";
    }

    override get descriptor(): NodeDef {
        return { name: "GetHp", type: "Action", desc: "获取生命值", output: ["hp"] };
    }
}
