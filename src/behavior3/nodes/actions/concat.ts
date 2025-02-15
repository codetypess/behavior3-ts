import type { Context, DeepReadonly } from "../../context";
import { Node, NodeDef, Status } from "../../node";
import { Tree } from "../../tree";

export class Concat extends Node {
    declare input: [unknown[], unknown[]];

    override onTick(tree: Tree<Context, unknown>): Status {
        const [arr1, arr2] = this.input;
        if (!Array.isArray(arr1) || !Array.isArray(arr2)) {
            return "failure";
        }
        this.output.push(arr1.concat(arr2));
        return "success";
    }

    static override get descriptor(): DeepReadonly<NodeDef> {
        return {
            name: "Concat",
            type: "Action",
            children: 0,
            status: ["success", "failure"],
            desc: "将两个输入合并为一个数组，并返回新数组",
            input: ["数组1", "数组2"],
            output: ["新数组"],
            doc: `
                + 如果输入不是数组，则返回 \`failure\`
            `,
        };
    }
}
