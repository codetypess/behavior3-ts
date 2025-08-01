import type { Context } from "../../context";
import { Node, NodeDef, Status } from "../../node";
import { Tree } from "../../tree";

export class Push extends Node {
    declare input: [unknown[], unknown];

    override onTick(tree: Tree<Context, unknown>, status: Status): Status {
        const [arr, element] = this.input;
        if (!Array.isArray(arr)) {
            this.error(`arr is not an array: ${arr}`);
            return "error";
        }
        arr.push(element);
        return "success";
    }

    static override get descriptor(): NodeDef {
        return {
            name: "Push",
            type: "Action",
            children: 0,
            status: ["success", "failure"],
            desc: "向数组中添加元素",
            input: ["数组", "元素"],
            doc: `
                + 当变量\`数组\`不是数组类型时返回 \`failure\`
                + 其余返回 \`success\`
            `,
        };
    }
}
