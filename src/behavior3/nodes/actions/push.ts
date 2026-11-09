import { type Context } from "../../context";
import { Node, NodeDef, Status } from "../../node";
import { registerNode } from "../../register-node";
import { Tree } from "../../tree";

@registerNode
export class Push extends Node {

    override onTick(tree: Tree<Context, unknown>, input: readonly [unknown[], unknown]): Status {
        const [arr, element] = input;
        if (!Array.isArray(arr)) {
            this.warn(`arr is not an array: ${arr}`);
            return "error";
        }
        arr.push(element);
        return "success";
    }

    static override get descriptor(): NodeDef {
        return {
            name: "Push",
            type: "Action",
            group: ["Core"],
            children: 0,
            status: ["success", "failure"],
            desc: "向数组末尾添加元素",
            input: ["数组", "元素"],
            doc: `
                + 把 \`元素\` 追加到 \`数组\` 末尾（直接修改原数组），返回 \`success\`
                + \`数组\` 不是数组时，返回 \`error\`
            `,
        };
    }
}
