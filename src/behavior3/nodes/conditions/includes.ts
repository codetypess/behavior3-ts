import { Node, NodeDef } from "../../node";
import { Process, Status } from "../../process";
import { TreeEnv } from "../../tree-env";

type NodeInput = [unknown, unknown[]];

export class Includes extends Process {
    override run(node: Node, env: TreeEnv): Status {
        const [arr, element] = env.input as NodeInput;
        if (!Array.isArray(arr) || element === undefined || element === null) {
            return "failure";
        }
        const index = arr.indexOf(element);
        return index >= 0 ? "success" : "failure";
    }

    override get descriptor(): NodeDef {
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
