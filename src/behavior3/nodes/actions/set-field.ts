import type { Context, DeepReadonly, ObjectType } from "../../context";
import { Node, NodeDef, Status } from "../../node";
import { Tree } from "../../tree";

export class SetField extends Node {
    declare input: [ObjectType, string?, unknown?];
    declare args: {
        readonly field?: string;
        readonly value?: unknown;
    };

    override onTick(tree: Tree<Context, unknown>): Status {
        const [obj] = this.input;
        if (typeof obj !== "object" || !obj) {
            this.warn(`invalid object: ${obj}`);
            return "failure";
        }

        const args = this.args;
        const field = this._checkOneof(1, args.field);
        const value = this._checkOneof(2, args.value, null);

        if (typeof field !== "string" && typeof field !== "number") {
            this.warn(`invalid field: ${field}`);
            return "failure";
        } else if (typeof obj[field] === "function") {
            this.warn(`not allowed to overwrite function ${field}`);
            return "failure";
        } else if (value === null || value === undefined) {
            delete obj[field];
            return "success";
        } else {
            obj[field] = value;
            return "success";
        }
    }

    get descriptor(): DeepReadonly<NodeDef> {
        return {
            name: "SetField",
            type: "Action",
            children: 0,
            status: ["success", "failure"],
            desc: "设置对象字段值",
            input: ["输入对象", "字段(field)?", "值(value)?"],
            args: [
                { name: "field", type: "string?", desc: "字段(field)", oneof: "字段(field)" },
                { name: "value", type: "json?", desc: "值(value)", oneof: "值(value)" },
            ],
            doc: `
                + 对输入对象设置 \`field\` 和 \`value\`
                + 输入参数1必须为对象，否则返回 \`failure\`
                + 如果 \`field\` 不为 \`string\`, 也返回 \`failure\`
                + 如果 \`value\` 为 \`undefined\` 或 \`null\`, 则删除 \`field\` 的值
            `,
        };
    }
}
