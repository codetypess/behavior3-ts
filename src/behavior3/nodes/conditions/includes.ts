import type { Context, DeepReadonly } from "../../context";
import { Node, NodeDef, Status } from "../../node";
import { Tree } from "../../tree";

export class Includes extends Node {
    declare input: [unknown, unknown[]];

    override onTick(tree: Tree<Context, unknown>): Status {
        const [arr, element] = this.input;
        if (!Array.isArray(arr) || element === undefined || element === null) {
            return "failure";
        }
        const index = arr.indexOf(element);
        return index >= 0 ? "success" : "failure";
    }

    get descriptor(): DeepReadonly<NodeDef> {
        return {
            name: "Includes",
            type: "Condition",
            children: 0,
            status: ["success", "failure"],
            desc: "判断元素是否在数组中",
            input: ["数组", "元素"],
            doc: `
                + 若输入的元素不合法，返回 \`failure\`
                + 只有数组包含元素时返回 \`success\`，否则返回 \`failure\`
            `,
        };
    }
}
