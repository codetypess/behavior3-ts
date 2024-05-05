import { Node, NodeDef } from "../../node";
import { Process, Status } from "../../process";
import { TreeEnv } from "../../tree-env";

type NodeInput = [unknown];

export class IsNull extends Process {
    override run(node: Node, env: TreeEnv): Status {
        const [value] = env.input as NodeInput;
        if (value === undefined || value === null) {
            return "success";
        } else {
            return "failure";
        }
    }

    override get descriptor(): NodeDef {
        return {
            name: "IsNull",
            type: "Condition",
            desc: "判断变量是否不存在",
            input: ["判断的变量"],
        };
    }
}
