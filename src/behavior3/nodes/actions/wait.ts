import { Node, NodeDef } from "../../node";
import { Process, Status } from "../../process";
import { TreeEnv } from "../../tree-env";

interface NodeArgs {
    time: number;
}

export class Wait extends Process {
    override check(node: Node): void {
        const args = node.args as NodeArgs;
        if (typeof args.time !== "number") {
            node.error(`args.time is not a number`);
        }
    }

    override run(node: Node, env: TreeEnv): Status {
        const t = node.resume(env);
        if (typeof t === "number") {
            if (env.context.time >= t) {
                return "success";
            } else {
                return "running";
            }
        } else {
            const args = node.args as NodeArgs;
            return node.yield(env, env.context.time + args.time);
        }
    }

    override get descriptor(): NodeDef {
        return {
            name: "Wait",
            type: "Action",
            desc: "等待",
            args: [{ name: "time", type: "float", desc: "时间/tick" }],
        };
    }
}
