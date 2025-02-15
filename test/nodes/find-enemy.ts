import { Node, NodeDef, Status, Tree } from "../../src/behavior3";
import { Role, RoleContext } from "../role";

export class FindEnemy extends Node {
    declare args: {
        w: number;
        h: number;
        count?: number;
    };

    override onTick(tree: Tree<RoleContext, Role>): Status {
        const owner = tree.owner;
        const args = this.args;
        const x = owner.x;
        const y = owner.y;
        const w = args.w;
        const h = args.h;
        const list = tree.context.find((role: Role) => {
            if (role === owner) {
                return false;
            }
            const tx = role.x;
            const ty = role.y;
            return Math.abs(x - tx) <= w && Math.abs(y - ty) <= h;
        }, args.count ?? -1);
        if (list.length) {
            this.output.push(...list);
            return "success";
        } else {
            return "failure";
        }
    }

    override get descriptor(): Readonly<NodeDef> {
        return {
            name: "FindEnemy",
            type: "Action",
            desc: "寻找敌人",
            output: ["敌人"],
            args: [
                { name: "w", type: "int", desc: "宽度" },
                { name: "h", type: "int", desc: "高度" },
                { name: "count", type: "int?", desc: "数量" },
            ],
        };
    }
}
