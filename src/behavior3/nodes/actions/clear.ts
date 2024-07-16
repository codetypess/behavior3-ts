import { Node, NodeDef } from "../../node";
import { Process, Status } from "../../process";
import { TreeEnv } from "../../tree-env";

export class Clear extends Process {
    override run(node: Node, env: TreeEnv): Status {
        env.output.push(undefined);
        return "success";
    }

    override get descriptor(): NodeDef {
        return {
            name: "Clear",
            type: "Action",
            status: ["success"],
            desc: "清除变量",
            output: ["清除的变量名"],
        };
    }
}
