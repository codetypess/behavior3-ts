import { Node, NodeDef } from "../../node";
import { Process, Status } from "../../process";
import { TreeEnv } from "../../tree-env";

export class GetTime extends Process {
    override run(node: Node, env: TreeEnv): Status {
        env.output.push(env.context.time);
        return "success";
    }

    override get descriptor(): NodeDef {
        return {
            name: "GetTime",
            type: "Action",
            desc: "获取当前时间",
            output: ["当前时间"],
        };
    }
}
