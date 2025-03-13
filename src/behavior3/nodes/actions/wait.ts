import type { Context } from "../../context";
import { Node, NodeDef, Status } from "../../node";
import { Tree } from "../../tree";

export class Wait extends Node {
    declare args: {
        readonly time: number;
        readonly random?: number;
    };

    override onTick(tree: Tree<Context, unknown>, status: Status): Status {
        const t: number | undefined = tree.resume(this);
        if (typeof t === "number") {
            if (tree.context.time >= t) {
                return "success";
            } else {
                return "running";
            }
        } else {
            const args = this.args;
            let time = this._checkOneof(0, args.time, 0);
            if (args.random) {
                time += (Math.random() - 0.5) * args.random;
            }
            return tree.yield(this, tree.context.time + time);
        }
    }

    static override get descriptor(): NodeDef {
        return {
            name: "Wait",
            type: "Action",
            children: 0,
            status: ["success", "running"],
            desc: "等待",
            input: ["等待时间?"],
            args: [
                {
                    name: "time",
                    type: "float?",
                    desc: "等待时间",
                    oneof: "等待时间",
                },
                {
                    name: "random",
                    type: "float?",
                    desc: "随机范围",
                },
            ],
        };
    }
}
