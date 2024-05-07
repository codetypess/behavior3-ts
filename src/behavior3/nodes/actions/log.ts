import { Node, NodeDef } from "../../node";
import { Process, Status } from "../../process";
import { TreeEnv } from "../../tree-env";

interface NodeArgs {
    readonly message: string;
}

export class Log extends Process {
    override run(node: Node, env: TreeEnv): Status {
        const args = node.args as NodeArgs;
        console.log("behavior3 -> log:", args.message);
        return "success";
    }

    override get descriptor(): NodeDef {
        return {
            name: "Log",
            type: "Action",
            desc: "打印日志",
            args: [{ name: "message", type: "string", desc: "日志" }],
        };
    }
}
