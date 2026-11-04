import { type Context } from "../../context";
import { Node, NodeDef, Status } from "../../node";
import { registerNode } from "../../register-node";
import { Tree } from "../../tree";

@registerNode
export class Repeat extends Node {
    declare args: { readonly count: number };

    override onTick(tree: Tree<Context, unknown>): Status {
        const count = this._checkOneof(0, this.args.count, Number.MAX_SAFE_INTEGER);
        let i = tree.getState<number>(this) ?? 0;

        for (; i < count; i++) {
            const status = this.children[0].tick(tree);
            if (status === "running") {
                tree.setState(this, i);
                return "running";
            } else if (status === "failure" || status === "error") {
                return status;
            }
        }
        return "success";
    }

    static override get descriptor(): NodeDef {
        return {
            name: "Repeat",
            type: "Decorator",
            group: ["Core"],
            children: 1,
            status: ["success", "|running", "|failure"],
            desc: "重复执行子节点指定次数",
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
                + 重复执行子节点 \`循环次数\` 次，都成功后返回 \`success\`；没有配置次数时一直循环
                + 子节点返回 \`failure\` 或 \`error\` 时，退出循环并返回该状态
                + 子节点返回 \`running\` 时返回 \`running\`，下次继续这一轮
            `,
        };
    }
}
