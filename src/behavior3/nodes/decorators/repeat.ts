import type { Context, DeepReadonly } from "../../context";
import { Node, NodeDef, Status } from "../../node";
import { Tree } from "../../tree";

export class Repeat extends Node {
    declare args: { readonly count: number };

    override onTick(tree: Tree<Context, unknown>): Status {
        const count = this._checkOneof(0, this.args.count, Number.MAX_SAFE_INTEGER);
        const lastNodeStatus = tree.lastNodeStatus;
        let i: number | undefined = tree.resume(this);

        if (i !== undefined) {
            if (lastNodeStatus === "running") {
                this.error(`unexpected status error`);
            } else if (lastNodeStatus === "failure") {
                return "failure";
            }
            i++;
        } else {
            i = 0;
        }

        for (; i < count; i++) {
            const status = this.children[0].tick(tree);
            if (status === "running") {
                return tree.yield(this, i);
            } else if (status === "failure") {
                return "failure";
            }
        }
        return "success";
    }

    static override get descriptor(): DeepReadonly<NodeDef> {
        return {
            name: "Repeat",
            type: "Decorator",
            children: 1,
            status: ["success", "|running", "|failure"],
            desc: "循环执行",
            input: ["循环次数?"],
            args: [
                {
                    name: "count",
                    type: "int?",
                    desc: "循环次数",
                    oneof: "循环次数",
                },
            ],
            doc: `
                + 只能有一个子节点，多个仅执行第一个
                + 当子节点返回 \`failure\` 时，退出遍历并返回 \`failure\` 状态
                + 执行完所有子节点后，返回 \`success\`
            `,
        };
    }
}
