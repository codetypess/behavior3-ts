import { type Context } from "../../context";
import { Node, NodeDef, Status } from "../../node";
import { registerNode } from "../../register-node";
import { Tree } from "../../tree";

@registerNode
export class Wait extends Node {
    declare args: {
        readonly time: number;
        readonly random?: number;
    };

    override onTick(tree: Tree<Context, unknown>, input: readonly unknown[]): Status {
        const expired = tree.getState<number>(this);
        if (expired !== undefined) {
            return tree.context.time >= expired ? "success" : "running";
        }

        const args = this.args;
        let time = this._checkOneof(input, 0, args.time, 0);
        if (args.random) {
            time += (Math.random() - 0.5) * args.random;
        }
        tree.setState(this, tree.context.time + time);
        return "running";
    }

    static override get descriptor(): NodeDef {
        return {
            name: "Wait",
            type: "Action",
            group: ["Core"],
            children: 0,
            status: ["success", "running"],
            desc: "等待一段时间后返回成功",
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
                    desc: "随机浮动范围",
                },
            ],
            doc: `
                + 等待期间返回 \`running\`，时间到了返回 \`success\`
                + 配置了 \`随机浮动范围\` 时，实际等待时间在 \`等待时间 ± 随机浮动范围 / 2\` 内随机
            `,
        };
    }
}
