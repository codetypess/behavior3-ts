import { Node, NodeDef } from "../../node";
import { Process, Status } from "../../process";
import { TreeEnv } from "../../tree-env";

type Input = [unknown[] | { [key: string]: unknown }, string | number | undefined];

type NodeArgs = {
    idx: string;
};

interface NodeVars {
    readonly index: number;
    readonly key: string;
}

export class Index extends Process {
    override init(node: Node): NodeVars {
        const args = node.args as NodeArgs;
        return {
            key: args.idx,
            index: parseInt(args.idx),
        };
    }

    override run(node: Node, env: TreeEnv): Status {
        const [arr] = env.input as Input;
        const vars = node.vars as NodeVars;
        let value = undefined;
        if (arr instanceof Array) {
            const index = this._checkOneof(node, env, 1, vars.index);
            if (typeof index !== "number" || isNaN(index)) {
                node.warn(`invalid index: ${vars.key}`);
            } else {
                value = arr[index];
            }
        } else if (typeof arr === "object" && arr !== null) {
            const key = this._checkOneof(node, env, 1, vars.key);
            value = arr[key];
        }

        if (value !== undefined && value !== null) {
            env.output.push(value);
            return "success";
        } else {
            return "failure";
        }
    }

    override get descriptor(): NodeDef {
        return {
            name: "Index",
            type: "Action",
            children: 0,
            status: ["success", "failure"],
            desc: "索引输入的数组或对象",
            args: [
                {
                    name: "idx",
                    type: "string?",
                    desc: "索引",
                    oneof: "索引",
                },
            ],
            input: ["输入目标", "索引?"],
            output: ["输出目标"],
            doc: `
                + 合法元素不包括 \`undefined\` 和 \`null\`
                + 只有索引到有合法元素时候才会返回\`success\`，否则返回\`failure\`
            `,
        };
    }
}
