import type { Context } from "../../context";
import { Node, NodeDef, Status } from "../../node";
import { Tree } from "../../tree";

export class Index extends Node {
    declare input: [unknown[], number | undefined];
    declare args: { readonly index: number };

    override onTick(tree: Tree<Context, unknown>, status: Status): Status {
        const [arr] = this.input;

        if (!Array.isArray(arr)) {
            this.error(`invalid array: ${arr}`);
            return "error";
        }

        const index = this._checkOneof(1, this.args.index);
        const value = arr[index];
        if (value !== undefined && value !== null) {
            this.output.push(value);
            return "success";
        } else if (typeof index !== "number" || isNaN(index)) {
            this.error(`invalid index: ${index}`);
            return "error";
        }

        return "failure";
    }

    static override get descriptor(): NodeDef {
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
