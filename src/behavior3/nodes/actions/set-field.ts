import { type Context, type ObjectType } from "../../context";
import { ERROR, Node, NodeDef, Status } from "../../node";
import { registerNode } from "../../register-node";
import { Tree } from "../../tree";

@registerNode
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
            return "error";
        }

        const args = this.args;
        const field = this._checkOneof(1, args.field);
        const value = this._checkOneof(2, args.value, null);

        if (field === ERROR) {
            return "error";
        } else if (typeof field !== "string" && typeof field !== "number") {
            this.warn(`invalid field: ${field}`);
            return "error";
        } else if (value === null || value === undefined) {
            delete obj[field];
            return "success";
        } else {
            obj[field] = value;
            return "success";
        }
    }

    static override get descriptor(): NodeDef {
        return {
            name: "SetField",
            type: "Action",
            group: ["Core"],
            children: 0,
            status: ["success", "failure"],
            desc: "设置对象的字段值",
            input: ["对象", "字段名?", "字段值?"],
            args: [
                { name: "field", type: "string?", desc: "字段名", oneof: "字段名" },
                { name: "value", type: "json?", desc: "字段值", oneof: "字段值" },
            ],
            doc: `
                + 设置 \`对象[字段名] = 字段值\`（直接修改原对象），返回 \`success\`
                + \`字段名\` 和 \`字段值\` 都可以用参数或输入变量指定
                + 字段值为 \`undefined\` 或 \`null\` 时，删除该字段
                + 输入不是对象，或者字段名不是 \`string\` 或 \`number\` 时，返回 \`error\`
            `,
        };
    }
}
