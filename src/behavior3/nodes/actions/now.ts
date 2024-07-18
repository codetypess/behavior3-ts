import { Node, NodeDef } from "../../node";
import { Process, Status } from "../../process";
import { TreeEnv } from "../../tree-env";

export class Now extends Process {
    override run(node: Node, env: TreeEnv): Status {
        env.output.push(env.context.time);
        return "success";
    }

    override get descriptor(): NodeDef {
        return {
            name: "Now",
            type: "Action",
            children: 0,
            status: ["success"],
            desc: "获取当前时间",
            output: ["当前时间"],
        };
    }
}
