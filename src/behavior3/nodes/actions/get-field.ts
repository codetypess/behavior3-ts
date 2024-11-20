import { Node, NodeDef } from "../../node";
import { Process, Status } from "../../process";
import { TreeEnv } from "../../tree-env";

type Input = [{ [key: string]: unknown }, string | undefined];

type NodeArgs = {
    field?: string;
};

export class GetField extends Process {
    override tick(node: Node, env: TreeEnv): Status {
        const [obj] = env.input as Input;
        if (typeof obj !== "object" || !obj) {
            node.warn(`invalid object: ${obj}`);
            return "failure";
        }

        const args = node.args as NodeArgs;
        const field = this._checkOneof(node, env, 1, args.field);
        const value = obj[field];
        if (typeof field !== "string" && typeof field !== "number") {
            node.warn(`invalid field: ${field}`);
            return "failure";
        } else if (value !== undefined && value !== null) {
            env.output.push(value);
            return "success";
        } else {
            return "failure";
        }
    }

    override get descriptor(): NodeDef {
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
