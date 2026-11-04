import { type Context } from "../../context";
import { Node, NodeDef, Status } from "../../node";
import { registerNode } from "../../register-node";
import { Tree } from "../../tree";

@registerNode
export class Let extends Node {
    declare args: { readonly value?: unknown };

    override onTick(tree: Tree<Context, unknown>): Status {
        const value = this._checkOneof(0, this.args.value, null);
        this.output.push(value);
        return "success";
    }

    static override get descriptor(): NodeDef {
        return {
            name: "Let",
            type: "Action",
            group: ["Core"],
            children: 0,
            status: ["success"],
            desc: "给变量赋值",
            input: ["源变量?"],
            args: [
                {
                    name: "value",
                    type: "json?",
                    desc: "值",
                    oneof: "源变量",
                },
            ],
            output: ["目标变量"],
            doc: `
                + 把 \`值\` 或 \`源变量\` 的值写入 \`目标变量\`，返回 \`success\`
                + 用 \`源变量\` 时，相当于给已有的值换一个变量名
                + 都没有配置，或者 \`值\` 为 \`null\` 时，清除 \`目标变量\`
            `,
        };
    }
}
