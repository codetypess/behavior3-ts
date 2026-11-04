import { type Context } from "../../context";
import { Node, NodeData, NodeDef, Status } from "../../node";
import { registerNode } from "../../register-node";
import { Tree } from "../../tree";

@registerNode
export class Check extends Node {
    declare args: { readonly value: string };

    constructor(context: Context, cfg: NodeData) {
        super(context, cfg);

        if (typeof this.args.value !== "string" || this.args.value.length === 0) {
            this.throw(`args.value is not a expr string`);
        }
        context.compileCode(this.args.value);
    }

    override onTick(tree: Tree<Context, unknown>): Status {
        let value: unknown;
        try {
            value = tree.blackboard.eval(this.args.value);
        } catch (e) {
            // a bad value in the blackboard, such as a missing variable
            this.warn(e instanceof Error ? e.message : String(e));
            return "error";
        }
        return value ? "success" : "failure";
    }

    static override get descriptor(): NodeDef {
        return {
            name: "Check",
            type: "Condition",
            group: ["Core"],
            children: 0,
            status: ["success", "failure"],
            desc: "表达式为真时返回成功",
            args: [{ name: "value", type: "expr", desc: "表达式" }],
            doc: `
                + 用黑板变量计算 \`表达式\`，结果为真时返回 \`success\`，否则返回 \`failure\`
                + 求值出错时（比如引用了不存在的变量），返回 \`error\`
            `,
        };
    }
}
