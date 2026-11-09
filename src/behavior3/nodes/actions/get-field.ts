import { type Context } from "../../context";
import { ERROR, Node, NodeDef, Status } from "../../node";
import { registerNode } from "../../register-node";
import { Tree } from "../../tree";

@registerNode
export class GetField extends Node {
    declare args: { readonly field?: string };

    override onTick(
        tree: Tree<Context, unknown>,
        input: readonly [{ [key: string]: unknown }, string | undefined],
        output: unknown[],
    ): Status {
        const [obj] = input;
        if (typeof obj !== "object" || !obj) {
            this.warn(`invalid object: ${obj}`);
            return "error";
        }

        const args = this.args;
        const field = this._checkOneof(input, 1, args.field);
        if (field === ERROR) {
            return "error";
        } else if (typeof field !== "string" && typeof field !== "number") {
            this.warn(`invalid field: ${field}`);
            return "error";
        }

        const value = obj[field];
        if (value !== undefined && value !== null) {
            output.push(value);
            return "success";
        } else {
            return "failure";
        }
    }

    static override get descriptor(): NodeDef {
        return {
            name: "GetField",
            type: "Action",
            group: ["Core"],
            children: 0,
            status: ["success", "failure"],
            desc: "读取对象的字段值",
            args: [
                {
                    name: "field",
                    type: "string?",
                    desc: "字段名",
                    oneof: "字段名",
                },
            ],
            input: ["对象", "字段名?"],
            output: ["字段值"],
            doc: `
                + 读取 \`对象[字段名]\` 写入 \`字段值\`，\`字段名\` 可以用参数或输入变量指定
                + 字段值不为 \`undefined\` 或 \`null\` 时返回 \`success\`，否则返回 \`failure\`
                + 输入不是对象，或者字段名不是 \`string\` 或 \`number\` 时，返回 \`error\`
            `,
        };
    }
}
