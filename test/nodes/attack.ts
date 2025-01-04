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
            input: ["目标敌人", "技能..."],
            output: ["结果", "数值..."],
            args: [
                {
                    name: "distance",
                    type: "int?",
                    desc: "攻击距离",
                },
                {
                    name: "range",
                    type: "int",
                    desc: "距离",
                },
                {
                    name: "enemy",
                    type: "string[]",
                    desc: "敌人",
                },
                {
                    name: "multi",
                    type: "bool[]",
                    desc: "是否多目标",
                },
                {
                    name: "data",
                    type: "json[]",
                    desc: "数据",
                },
                {
                    name: "velocity",
                    type: "float[]",
                    desc: "速度",
                },
                {
                    name: "target",
                    type: "enum[]",
                    desc: "目标",
                    options: [
                        {
                            name: "敌人",
                            value: "enemy",
                        },
                        {
                            name: "自己",
                            value: "self",
                        },
                    ],
                },
            ],
        };
    }
}
