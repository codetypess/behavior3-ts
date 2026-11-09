import { type Context } from "../../context";
import { Node, NodeDef, Status } from "../../node";
import { registerNode } from "../../register-node";
import { Tree } from "../../tree";

@registerNode
export class RandomIndex extends Node {

    override onTick(
        tree: Tree<Context, unknown>,
        input: readonly [unknown[]],
        output: unknown[],
    ): Status {
        const [arr] = input;
        if (!(arr instanceof Array)) {
            this.warn(`invalid array: ${arr}`);
            return "error";
        }

        if (arr.length === 0) {
            return "failure";
        }

        const idx = Math.floor(Math.random() * arr.length);
        const value = arr[idx];
        if (value !== undefined && value !== null) {
            output.push(value);
            output.push(idx);
            return "success";
        } else {
            return "failure";
        }
    }

    static override get descriptor(): NodeDef {
        return {
            name: "RandomIndex",
            type: "Action",
            group: ["Core"],
            children: 0,
            status: ["success", "failure"],
            desc: "从数组中随机取一个元素",
            input: ["数组"],
            output: ["随机元素", "索引?"],
            doc: `
                + 从 \`数组\` 中随机取一个元素写入 \`随机元素\`，它的下标写入 \`索引\`，返回 \`success\`
                + 数组为空，或者取到的元素为 \`undefined\` 或 \`null\` 时，返回 \`failure\`
                + 输入不是数组时，返回 \`error\`
            `,
        };
    }
}
