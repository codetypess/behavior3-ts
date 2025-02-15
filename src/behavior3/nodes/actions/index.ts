import type { Context, DeepReadonly } from "../../context";
import { Node, NodeDef, Status } from "../../node";
import { Tree } from "../../tree";

export class Index extends Node {
    declare input: [unknown[], number | undefined];
    declare args: { readonly index: number };

    override onTick(tree: Tree<Context, unknown>): Status {
        const [arr] = this.input;
        if (arr instanceof Array) {
            const index = this._checkOneof(1, this.args.index);
            const value = arr[index];
            if (value !== undefined && value !== null) {
                this.output.push(value);
                return "success";
            } else if (typeof index !== "number" || isNaN(index)) {
                this.warn(`invalid index: ${index}`);
            }
        } else {
            this.warn(`invalid array: ${arr}`);
        }

        return "failure";
    }

    static override get descriptor(): DeepReadonly<NodeDef> {
        return {
            name: "Index",
            type: "Action",
            children: 0,
            status: ["success", "failure"],
            desc: "索引输入的数组",
            args: [
                {
                    name: "index",
                    type: "int?",
                    desc: "索引",
                    oneof: "索引",
                },
            ],
            input: ["数组", "索引?"],
            output: ["值"],
            doc: `
                + 合法元素不包括 \`undefined\` 和 \`null\`
                + 索引数组的时候，第一个元素的索引为 0
                + 只有索引到有合法元素时候才会返回 \`success\`，否则返回 \`failure\`
            `,
        };
    }
}
