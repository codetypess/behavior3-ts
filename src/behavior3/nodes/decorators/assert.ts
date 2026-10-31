import { type Context } from "../../context";
import { Node, NodeDef, Status } from "../../node";
import { registerNode } from "../../register-node";
import { Tree } from "../../tree";

@registerNode
export class Assert extends Node {
    declare args: { readonly message: string };

    override onTick(tree: Tree<Context, unknown>): Status {
        const status = this.children[0].tick(tree);
        if (status === "success" || status === "running") {
            return status;
        }
        this.throw(this.args.message);
    }

    static override get descriptor(): NodeDef {
        return {
            name: "Assert",
            type: "Decorator",
            children: 1,
            status: ["success"],
            desc: "断言",
            args: [
                {
                    name: "message",
                    type: "string",
                    desc: "消息",
                },
            ],
            doc: `
                + 只能有一个子节点，多个仅执行第一个
                + 当子节点返回 \`failure\` 时，抛出异常
                + 其余情况返回子节点的执行状态
            `,
        };
    }
}
