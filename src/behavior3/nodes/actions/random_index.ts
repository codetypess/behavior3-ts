import { Node, NodeDef } from "../../node";
import { Process, Status } from "../../process";
import { TreeEnv } from "../../tree-env";

type Input = [unknown[]];

export class RandomIndex extends Process {
    override run(node: Node, env: TreeEnv): Status {
        const [arr] = env.input as Input;
        if (!(arr instanceof Array) || arr.length === 0) {
            return "failure";
        }

        const idx = Math.floor(Math.random() * arr.length);
        const value = arr[idx];
        if (value !== undefined && value !== null) {
            env.output.push(value);
            return "success";
        } else {
            return "failure";
        }
    }

    override get descriptor(): NodeDef {
        return {
            name: "RandomIndex",
            type: "Action",
            children: 0,
            status: ["success", "failure"],
            desc: "随机返回输入的其中一个!",
            input: ["输入目标"],
            output: ["随机目标"],
            doc: `
                + 合法元素不包括 \`undefined\` 和 \`null\`
                + 在输入数组中，随机返回其中一个
                + 当输入数组为空时，或者没有合法元素，返回\`failure\`
            `,
        };
    }
}
