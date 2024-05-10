import { Node, NodeDef, Process, Status, TreeEnv } from "../../src/behavior3";
import { Role } from "../role";

type AttackInput = [Role | undefined];

export class Attack extends Process {
    override run(node: Node, env: TreeEnv): Status {
        const [enemy] = env.input as AttackInput;
        if (!enemy) {
            return "failure";
        }
        console.log("Do Attack");
        enemy.hp -= 100;
        env.set("ATTACKING", true);
        return "success";
    }

    override get descriptor(): NodeDef {
        return { name: "Attack", type: "Action", desc: "攻击", input: ["目标敌人"] };
    }
}
