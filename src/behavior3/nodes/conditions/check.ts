import type { Context } from "../../context";
import { Node, NodeData, NodeDef, Status } from "../../node";
import { Tree } from "../../tree";

export class Check extends Node {
    declare args: { readonly value: string };

    constructor(context: Context, cfg: NodeData) {
        super(context, cfg);

        if (typeof this.args.value !== "string" || this.args.value.length === 0) {
            this.throw(`args.value is not a expr string`);
        }
        context.compileCode(this.args.value);
    }

    override onTick(tree: Tree<Context, unknown>, status: Status): Status {
        const value = tree.blackboard.eval(this.args.value);
        return value ? "success" : "failure";
    }

    static override get descriptor(): NodeDef {
        return {
            name: "Check",
            type: "Condition",
            children: 0,
            status: ["success", "failure"],
            desc: "检查True或False",
            args: [{ name: "value", type: "expr", desc: "值" }],
            doc: `
                + 做简单数值公式判定，返回 \`success\` 或 \`failure\`
            `,
        };
    }
}
