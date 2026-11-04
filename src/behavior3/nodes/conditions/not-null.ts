import { type Context } from "../../context";
import { Node, NodeDef, Status } from "../../node";
import { registerNode } from "../../register-node";
import { Tree } from "../../tree";

@registerNode
export class NotNull extends Node {
    declare input: [unknown];

    override onTick(tree: Tree<Context, unknown>): Status {
        const [value] = this.input;
        if (value === undefined || value === null) {
            return "failure";
        } else {
            return "success";
        }
    }

    static override get descriptor(): NodeDef {
        return {
            name: "NotNull",
            type: "Condition",
            group: ["Core"],
            children: 0,
            status: ["success", "failure"],
            desc: "变量不为空时返回成功",
            input: ["变量"],
            doc: `
                + \`变量\` 不为 \`undefined\` 和 \`null\` 时返回 \`success\`，否则返回 \`failure\`
            `,
        };
    }
}
