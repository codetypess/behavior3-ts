import { Node, NodeDef } from "../../node";
import { Process, Status } from "../../process";
import { TreeEnv } from "../../tree-env";

interface NodeArgs {
    readonly time: number;
    readonly random?: number;
}

type NodeInput = [number | undefined];

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
            let [time] = env.input as NodeInput;
            const args = node.args as NodeArgs;
            time = time ?? args.time;
            if (args.random) {
                time += (Math.random() - 0.5) * args.random;
            }
            return node.yield(env, env.context.time + time);
        }
    }

    override get descriptor(): NodeDef {
        return {
            name: "Wait",
            type: "Action",
            desc: "等待",
            input: ["等待时间?"],
            args: [
                { name: "time", type: "float", desc: "等待时间" },
                { name: "random", type: "float?", desc: "随机范围" },
            ],
        };
    }
}
