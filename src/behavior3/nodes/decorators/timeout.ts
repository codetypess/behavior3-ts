import { type Context } from "../../context";
import { Node, NodeDef, Status } from "../../node";
import { registerNode } from "../../register-node";
import { Tree } from "../../tree";

@registerNode
export class Timeout extends Node {
    declare args: { readonly time?: number };

    override onTick(tree: Tree<Context, unknown>): Status {
        const child = this.children[0];
        const time = tree.context.time;
        let expired = tree.getState<number>(this);

        if (expired === undefined) {
            expired = time + this._checkOneof(0, this.args.time, 0);
        } else if (time >= expired) {
            child.abort(tree);
            return "failure";
        }

        const status = child.tick(tree);
        if (status === "running") {
            tree.setState(this, expired);
        }
        return status;
    }

    static override get descriptor(): NodeDef {
        return {
            name: "Timeout",
            type: "Decorator",
            group: ["Core"],
            children: 1,
            status: ["|success", "|running", "failure"],
            desc: "限时执行子节点，超时返回失败",
            input: ["超时时间?"],
            args: [
                {
                    name: "time",
                    type: "float?",
                    desc: "超时时间",
                    oneof: "超时时间",
                },
            ],
            doc: `
                + 只能有一个子节点，多个仅执行第一个
                + 子节点运行超过 \`超时时间\` 时，中止子节点并返回 \`failure\`
                + 没有超时前，返回子节点的状态
            `,
        };
    }
}
