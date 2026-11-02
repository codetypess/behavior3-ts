import { type Context } from "../../context";
import { ERROR, Node, NodeDef, Status } from "../../node";
import { registerNode } from "../../register-node";
import { Tree } from "../../tree";

@registerNode
export class GetField extends Node {
    declare input: [{ [key: string]: unknown }, string | undefined];
    declare args: { readonly field?: string };

    override onTick(tree: Tree<Context, unknown>): Status {
        const [obj] = this.input;
        if (typeof obj !== "object" || !obj) {
            this.warn(`invalid object: ${obj}`);
            return "error";
        }

        const args = this.args;
        const field = this._checkOneof(1, args.field);
        if (field === ERROR) {
            return "error";
        } else if (typeof field !== "string" && typeof field !== "number") {
            this.warn(`invalid field: ${field}`);
            return "error";
        }

        const value = obj[field];
        if (value !== undefined && value !== null) {
            this.output.push(value);
            return "success";
        } else {
            return "failure";
        }
    }

    static override get descriptor(): NodeDef {
        return {
            name: "GetField",
            type: "Action",
            children: 0,
            status: ["success", "failure"],
            desc: "获取对象的字段值",
            args: [
                {
                    name: "field",
                    type: "string?",
                    desc: "字段(field)",
                    oneof: "字段(field)",
                },
            ],
            input: ["对象", "字段(field)?"],
            output: ["字段值(value)"],
            doc: `
                + 合法元素不包括 \`undefined\` 和 \`null\`
                + 只有获取到合法元素时候才会返回 \`success\`，否则返回 \`failure\`
                + 输入不是对象，或者 \`field\` 不为 \`string\` 或 \`number\` 时，返回 \`error\`
            `,
        };
    }
}
