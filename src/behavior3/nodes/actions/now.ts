import { Node } from "../../node";
import { Process, Status } from "../../process";
import { TreeEnv } from "../../tree-env";

export class Now extends Process {
    constructor() {
        super({
            name: "Now",
            type: "Action",
            children: 0,
            status: ["success"],
            desc: "获取当前时间",
            output: ["当前时间"],
        });
    }

    override tick(node: Node, env: TreeEnv): Status {
        env.output.push(env.context.time);
        return "success";
    }
}
