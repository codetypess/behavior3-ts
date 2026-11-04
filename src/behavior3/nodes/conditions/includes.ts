import { type Context } from "../../context";
import { Node, NodeDef, Status } from "../../node";
import { registerNode } from "../../register-node";
import { Tree } from "../../tree";

@registerNode
export class Includes extends Node {
    declare input: [unknown, unknown[]];

    override onTick(tree: Tree<Context, unknown>): Status {
        const [arr, element] = this.input;
        if (!Array.isArray(arr)) {
            this.warn(`invalid array: ${arr}`);
            return "error";
        } else if (element === undefined || element === null) {
            return "failure";
        }
        const index = arr.indexOf(element);
        return index >= 0 ? "success" : "failure";
    }

    static override get descriptor(): NodeDef {
        return {
            name: "Includes",
            type: "Condition",
            group: ["Core"],
            children: 0,
            status: ["success", "failure"],
            desc: "数组包含元素时返回成功",
            input: ["数组", "元素"],
            doc: `
                + \`数组\` 包含 \`元素\`（按 \`===\` 比较）时返回 \`success\`，否则返回 \`failure\`
                + \`元素\` 为 \`undefined\` 或 \`null\` 时，返回 \`failure\`
                + \`数组\` 不是数组时，返回 \`error\`
            `,
        };
    }
}
