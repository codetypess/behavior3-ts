import { Node, NodeDef } from "../../node";
import { Process, Status } from "../../process";
import { TreeEnv } from "../../tree-env";

type NodeInput = [number?, number?];

interface NodeArgs {
    min: number;
    max: number;
    floor?: boolean;
}

export class Random extends Process {
    override run(node: Node, env: TreeEnv): Status {
        let [min, max] = env.input as NodeInput;
        const args = node.args as unknown as NodeArgs;
        min = min ?? args.min;
        max = max ?? args.max;
        let value = min + Math.random() * (max - min);
        if (args.floor) {
            value = Math.floor(value);
        }
        env.output.push(value);
        return "success";
    }

    override get descriptor(): NodeDef {
        return {
            name: "Random",
            type: "Action",
            children: 0,
            status: ["success"],
            desc: "返回一个随机数",
            input: ["最小值?", "最大值?"],
            args: [
                { name: "min", type: "float", desc: "最小值" },
                { name: "max", type: "float", desc: "最大值" },
                { name: "floor", type: "boolean?", desc: "是否向下取整" },
            ],
            output: ["随机数"],
        };
    }
}
