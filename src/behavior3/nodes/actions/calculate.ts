import { type Context } from "../../context";
import { Node, NodeData, NodeDef, Status } from "../../node";
import { registerNode } from "../../register-node";
import { Tree } from "../../tree";

@registerNode
export class Calculate extends Node {
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
        this.output.push(value);
        return "success";
    }

    static override get descriptor(): NodeDef {
        return {
            name: "Calculate",
            type: "Action",
            group: ["Core"],
            children: 0,
            status: ["success"],
            desc: "计算表达式，结果写入输出变量",
            args: [{ name: "value", type: "expr", desc: "表达式" }],
            output: ["计算结果"],
            doc: `
                + 用黑板变量计算 \`表达式\`，结果写入 \`计算结果\`，返回 \`success\`
                + 求值出错时（比如引用了不存在的变量），返回 \`error\`
            `,
        };
    }
}
