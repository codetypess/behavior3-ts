import { Node } from "../../node";
import { Process, Status } from "../../process";
import { TreeEnv } from "../../tree-env";

type NodeInput = [unknown];

export class NotNull extends Process {
    constructor() {
        super({
            name: "NotNull",
            type: "Condition",
            children: 0,
            status: ["success", "failure"],
            desc: "判断变量是否存在",
            input: ["判断的变量"],
        });
    }

    override tick(node: Node, env: TreeEnv): Status {
        const [value] = env.input as NodeInput;
        if (value === undefined || value === null) {
            return "failure";
        } else {
            return "success";
        }
    }
}
