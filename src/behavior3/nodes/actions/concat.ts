import { Node, NodeDef } from "../../node";
import { Process, Status } from "../../process";
import { TreeEnv } from "../../tree-env";

type NodeInput = [unknown[], unknown[]];

export class Concat extends Process {
    override run(node: Node, env: TreeEnv): Status {
        const [arr1, arr2] = env.input as NodeInput;
        if (!Array.isArray(arr1) || !Array.isArray(arr2)) {
            return "failure";
        }
        env.output.push(arr1.concat(arr2));
        return "success";
    }

    override get descriptor(): NodeDef {
        return {
            name: "Concat",
            type: "Action",
            children: 0,
            status: ["success", "failure"],
            desc: "将两个输入合并为一个数组，并返回新数组",
            input: ["数组1", "数组2"],
            output: ["新数组"],
            doc: `
                + 如果输入不是数组，则返回\`failure\`
            `,
        };
    }
}
