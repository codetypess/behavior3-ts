import type { Context, DeepReadonly } from "../../context";
import { Node, NodeData, NodeDef, Status } from "../../node";
import { Tree } from "../../tree";

export class Calculate extends Node {
    declare args: { readonly value: string };

    override init(context: Context, cfg: NodeData) {
        super.init(context, cfg);

        if (typeof this.args.value !== "string" || this.args.value.length === 0) {
            this.error(`args.value is not a expr string`);
        }
        context.compileCode(this.args.value);
    }

    override onTick(tree: Tree<Context, unknown>): Status {
        const value = tree.blackboard.eval(this.args.value);
        this.output.push(value);
        return "success";
    }

    get descriptor(): DeepReadonly<NodeDef> {
        return {
            name: "Calculate",
            type: "Action",
            children: 0,
            status: ["success"],
            desc: "简单的数值公式计算",
            args: [{ name: "value", type: "expr", desc: "计算公式" }],
            output: ["计算结果"],
            doc: `
                + 做简单的数值公式计算，返回结果到输出
            `,
        };
    }
}
