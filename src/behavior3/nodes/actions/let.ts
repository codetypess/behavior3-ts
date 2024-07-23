import { Node, NodeDef } from "../../node";
import { Process, Status } from "../../process";
import { TreeEnv } from "../../tree-env";

interface NodeArgs {
    expr?: unknown;
}

export class Let extends Process {
    override run(node: Node, env: TreeEnv): Status {
        const args = node.args as unknown as NodeArgs;
        const value = this._checkOneof(node, env, 0, args.expr, null);
        env.output.push(value);
        return "success";
    }

    override get descriptor(): NodeDef {
        return {
            name: "Let",
            type: "Action",
            children: 0,
            status: ["success"],
            desc: "定义新的变量名",
            input: ["已存在变量名?"],
            args: [
                {
                    name: "expr",
                    type: "json?",
                    desc: "表达式",
                    oneof: "已存在变量名",
                },
            ],
            output: ["新变量名"],
            doc: `
                + 如果有输入变量，则给已有变量重新定义一个名字
                + 如果有表达式，则使用表达式
                + 如果表达式为 \`null\`，则清除变量
            `,
        };
    }
}
