import { Node, NodeDef, Process, Status, TreeEnv } from "../../src/behavior3";
import { Role } from "../role";

type AttackInput = [Role | undefined];

export class Attack extends Process {
    constructor() {
        super({
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
                    type: "boolean[]",
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
        });
    }

    override tick(node: Node, env: TreeEnv): Status {
        const [enemy] = env.input as AttackInput;
        if (!enemy) {
            return "failure";
        }
        console.log("Do Attack");
        enemy.hp -= 100;
        env.set("ATTACKING", true);
        return "success";
    }
}
