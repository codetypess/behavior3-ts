import { Node, NodeDef } from "../../node";
import { Process, Status } from "../../process";
import { TreeEnv } from "../../tree-env";

type NodeInput = [unknown];

export class Let extends Process {
    override run(node: Node, env: TreeEnv): Status {
        const [input] = env.input as NodeInput;
        env.output.push(input);
        return "success";
    }

    override get descriptor(): NodeDef {
        return {
            name: "Let",
            type: "Action",
            status: ["success"],
            desc: "定义新的变量名",
            input: ["变量名"],
            output: ["新变量名"],
        };
    }
}
