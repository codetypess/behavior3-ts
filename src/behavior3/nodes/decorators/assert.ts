import { type Context } from "../../context";
import { Node, NodeDef, Status } from "../../node";
import { registerNode } from "../../register-node";
import { Tree } from "../../tree";

@registerNode
export class Assert extends Node {
    declare args: { readonly message: string };

    override onTick(tree: Tree<Context, unknown>): Status {
        const status = this.children[0].tick(tree);
        if (status === "failure") {
            this.warn(this.args.message);
            return "error";
        }
        return status;
    }

    static override get descriptor(): NodeDef {
        return {
            name: "Assert",
            type: "Decorator",
            group: ["Core"],
            children: 1,
            status: ["success"],
            desc: "断言子节点不会失败，失败时报错",
            args: [
                {
                    name: "message",
                    type: "string",
                    desc: "失败时的提示",
                },
            ],
            doc: `
                + 只能有一个子节点，多个仅执行第一个
                + 子节点返回 \`failure\` 时，打印 \`失败时的提示\` 并返回 \`error\`
                + 其余情况返回子节点的状态
            `,
        };
    }
}
