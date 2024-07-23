import { Node, NodeDef } from "../../node";
import { Process, Status } from "../../process";
import { TreeEnv } from "../../tree-env";

type ObjectType = { [key: string]: unknown };
type NodeInput = [ObjectType, string?, (string | number | unknown)?];

interface NodeArgs {
    key: string;
    value: number | string | ObjectType;
}

interface NodeVars {
    readonly index: number;
    readonly key: string;
}

export class Assign extends Process {
    override init(node: Node): NodeVars {
        const args = node.args as unknown as NodeArgs;
        return {
            key: args.key,
            index: parseInt(args.key),
        };
    }

    override run(node: Node, env: TreeEnv): Status {
        const [obj] = env.input as NodeInput;
        if (typeof obj !== "object" || obj === null) {
            console.error("Assign: inputObject is not an object", obj);
            return "failure";
        }

        const args = node.args as unknown as NodeArgs;
        const value = this._checkOneof(node, env, 2, args.value, null);
        if (obj instanceof Array) {
            const vars = node.vars as NodeVars;
            const index = this._checkOneof(node, env, 1, vars.index);
            if (typeof index !== "number" || isNaN(index)) {
                node.warn(`invalid index: ${vars.key}`);
                return "failure";
            } else {
                if (value === null || value === undefined) {
                    obj.splice(index, 1);
                } else {
                    obj[index] = value;
                }
                return "success";
            }
        } else {
            const key = this._checkOneof(node, env, 1, args.key);
            if (key === undefined) {
                node.warn(`key is undefined`);
                return "failure";
            }
            if (value === null || value === undefined) {
                delete obj[`${key}`];
            } else {
                obj[key] = value;
            }
            return "success";
        }
    }

    override get descriptor(): NodeDef {
        return {
            name: "Assign",
            type: "Action",
            children: 0,
            status: ["success"],
            desc: "对输入对象设置 key 和 value",
            input: ["输入对象", "输入key?", "输入value?"],
            args: [
                { name: "key", type: "string?", desc: "常量key", oneof: "输入key" },
                { name: "value", type: "json?", desc: "常量value", oneof: "输入value" },
            ],
            doc: `
                + 对输入对象设置 \`key\` 和 \`value\`
                + 输入参数1必须为对象，否则返回 \`failure\`
                + 如果 \`key\` 为 \`undefined\`, 也返回 \`failure\`
                + 如果 \`value\` 为 \`undefined\` 或 \`null\`, 则删除 \`key\` 的值
            `,
        };
    }
}
