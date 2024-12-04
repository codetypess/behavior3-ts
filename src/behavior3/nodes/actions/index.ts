import { Node } from "../../node";
import { Process, Status } from "../../process";
import { TreeEnv } from "../../tree-env";

type Input = [unknown[], number | undefined];

type NodeArgs = {
    index: number;
};

export class Index extends Process {
    constructor() {
        super({
            name: "Index",
            type: "Action",
            children: 0,
            status: ["success", "failure"],
            desc: "索引输入的数组",
            args: [
                {
                    name: "index",
                    type: "int?",
                    desc: "索引",
                    oneof: "索引",
                },
            ],
            input: ["数组", "索引?"],
            output: ["值"],
            doc: `
                + 合法元素不包括 \`undefined\` 和 \`null\`
                + 索引数组的时候，第一个元素的索引为 0
                + 只有索引到有合法元素时候才会返回 \`success\`，否则返回 \`failure\`
            `,
        });
    }

    override tick(node: Node, env: TreeEnv): Status {
        const [arr] = env.input as Input;
        if (arr instanceof Array) {
            const args = node.args as NodeArgs;
            const index = this._checkOneof(node, env, 1, args.index);
            const value = arr[index];
            if (value !== undefined && value !== null) {
                env.output.push(value);
                return "success";
            } else if (typeof index !== "number" || isNaN(index)) {
                node.warn(`invalid index: ${index}`);
            }
        } else {
            node.warn(`invalid array: ${arr}`);
        }

        return "failure";
    }
}
