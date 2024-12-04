import { Node } from "../../node";
import { Process, Status } from "../../process";
import { TreeEnv } from "../../tree-env";

interface NodeArgs {
    value?: unknown;
}

export class Let extends Process {
    constructor() {
        super({
            name: "Let",
            type: "Action",
            children: 0,
            status: ["success"],
            desc: "定义新的变量名",
            input: ["已存在变量名?"],
            args: [
                {
                    name: "value",
                    type: "json?",
                    desc: "值(value)",
                    oneof: "已存在变量名",
                },
            ],
            output: ["新变量名"],
            doc: `
                + 如果有输入变量，则给已有变量重新定义一个名字
                + 如果\`值(value)\`为 \`null\`，则清除变量
            `,
        });
    }

    override tick(node: Node, env: TreeEnv): Status {
        const args = node.args as unknown as NodeArgs;
        const value = this._checkOneof(node, env, 0, args.value, null);
        env.output.push(value);
        return "success";
    }
}
