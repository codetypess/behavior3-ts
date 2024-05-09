import { Node, NodeDef, Process, Status } from "../../src/behavior3";
import { Role, RoleTreeEnv } from "../role";

interface FindEnemyArgs {
    w: number;
    h: number;
    count?: number;
}

export class FindEnemy extends Process {
    override run(node: Node, env: RoleTreeEnv): Status {
        const args = node.args as unknown as FindEnemyArgs;
        const x = env.owner.x;
        const y = env.owner.y;
        const w = args.w;
        const h = args.h;
        const list = env.context.find((role: Role) => {
            if (role === env.owner) {
                return false;
            }
            const tx = role.x;
            const ty = role.y;
            return Math.abs(x - tx) <= w && Math.abs(y - ty) <= h;
        }, args.count ?? -1);
        if (list.length) {
            env.output.push(...list);
            return "success";
        } else {
            return "failure";
        }
    }

    override get descriptor(): NodeDef {
        return {
            name: "FindEnemy",
            type: "Action",
            desc: "寻找敌人",
            args: [
                { name: "w", type: "int", desc: "宽度" },
                { name: "h", type: "int", desc: "高度" },
                { name: "count", type: "int?", desc: "数量" },
            ],
        };
    }
}
