import type { Context } from "../../context";
import { Node, NodeDef, Status } from "../../node";
import { Tree } from "../../tree";

export class GetField extends Node {
    declare input: [{ [key: string]: unknown }, string | undefined];
    declare args: { readonly field?: string };

    override onTick(tree: Tree<Context, unknown>, status: Status): Status {
        const [obj] = this.input;
        if (typeof obj !== "object" || !obj) {
            this.error(`invalid object: ${obj}`);
            return "error";
        }

        const args = this.args;
        const field = this._checkOneof(1, args.field);
        const value = obj[field];
        if (typeof field !== "string" && typeof field !== "number") {
            this.error(`invalid field: ${field}`);
            return "error";
        } else if (value !== undefined && value !== null) {
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
            `,
        };
    }
}
