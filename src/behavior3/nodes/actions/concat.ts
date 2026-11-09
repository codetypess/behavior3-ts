import { type Context } from "../../context";
import { Node, NodeDef, Status } from "../../node";
import { registerNode } from "../../register-node";
import { Tree } from "../../tree";

@registerNode
export class Concat extends Node {

    override onTick(
        tree: Tree<Context, unknown>,
        input: readonly [unknown[], unknown[]],
        output: unknown[],
    ): Status {
        const [arr1, arr2] = input;
        if (!Array.isArray(arr1) || !Array.isArray(arr2)) {
            this.warn(`invalid array: ${arr1} or ${arr2}`);
            return "error";
        }
        output.push(arr1.concat(arr2));
        return "success";
    }

    static override get descriptor(): NodeDef {
        return {
            name: "Concat",
            type: "Action",
            group: ["Core"],
            children: 0,
            status: ["success", "failure"],
            desc: "拼接两个数组",
            input: ["数组1", "数组2"],
            output: ["新数组"],
            doc: `
                + 把 \`数组1\` 和 \`数组2\` 拼接成新数组写入 \`新数组\`，原数组不变，返回 \`success\`
                + 任一输入不是数组时，返回 \`error\`
            `,
        };
    }
}
