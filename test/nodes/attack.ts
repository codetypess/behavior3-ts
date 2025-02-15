import { Node, NodeDef, Status, Tree } from "../../src/behavior3";
import { Role, RoleContext } from "../role";

export class Attack extends Node {
    declare input: [Role | undefined];

    override onTick(tree: Tree<RoleContext, unknown>): Status {
        const [enemy] = this.input;
        if (!enemy) {
            return "failure";
        }
        console.log("Do Attack");
        enemy.hp -= 100;
        tree.blackboard.set("ATTACKING", true);
        return "success";
    }

    override get descriptor(): Readonly<NodeDef> {
        return {
            name: "Attack",
            type: "Action",
            desc: "攻击",
            input: ["目标敌人"],
            args: [],
        };
    }
}
