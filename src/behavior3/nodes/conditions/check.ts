import type { Context, DeepReadonly } from "../../context";
import { Node, NodeData, NodeDef, Status } from "../../node";
import { Tree } from "../../tree";

export class Check extends Node {
    declare args: { readonly value: string };

    override init(context: Context, cfg: NodeData): void {
        super.init(context, cfg);

        if (typeof this.args.value !== "string" || this.args.value.length === 0) {
            this.error(`args.value is not a expr string`);
        }
        context.compileCode(this.args.value);
    }

    override onTick(tree: Tree<Context, unknown>): Status {
        const value = tree.blackboard.eval(this.args.value);
        return value ? "success" : "failure";
    }

    get descriptor(): DeepReadonly<NodeDef> {
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
