import { Node } from "../../node";
import { Process, Status } from "../../process";
import { TreeEnv } from "../../tree-env";

type ObjectType = { [field: string]: unknown };
type NodeInput = [ObjectType, string?, unknown?];

interface NodeArgs {
    field?: string;
    value?: unknown;
}

export class SetField extends Process {
    constructor() {
        super({
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
        });
    }

    override tick(node: Node, env: TreeEnv): Status {
        const [obj] = env.input as NodeInput;
        if (typeof obj !== "object" || !obj) {
            node.warn(`invalid object: ${obj}`);
            return "failure";
        }

        const args = node.args as unknown as NodeArgs;
        const field = this._checkOneof(node, env, 1, args.field);
        const value = this._checkOneof(node, env, 2, args.value, null);

        if (typeof field !== "string" && typeof field !== "number") {
            node.warn(`invalid field: ${field}`);
            return "failure";
        } else if (typeof obj[field] === "function") {
            node.warn(`not allowed to overwrite function ${field}`);
            return "failure";
        } else if (value === null || value === undefined) {
            delete obj[field];
            return "success";
        } else {
            obj[field] = value;
            return "success";
        }
    }
}
