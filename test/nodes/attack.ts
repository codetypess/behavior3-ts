import { Node, NodeDef, Status, Tree } from "../../src/behavior3";
import { Role, RoleContext } from "../role";

export class Attack extends Node {

    override onTick(tree: Tree<RoleContext, unknown>, input: readonly [Role | undefined]): Status {
        const [enemy] = input;
        if (!enemy) {
            return "failure";
        }
        console.log("Do Attack");
        enemy.hp -= 100;
        tree.blackboard.set("ATTACKING", true);
        return "success";
    }

    static override get descriptor(): Readonly<NodeDef> {
        return {
            name: "Attack",
            type: "Action",
            group: ["Example"],
            desc: "攻击",
            input: ["目标敌人"],
            args: [],
        };
    }
}
