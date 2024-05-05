import { Node, NodeDef } from "../../node";
import { Process, Status } from "../../process";
import { TreeEnv } from "../../tree-env";

interface NodeArgs {
    count: number;
}

type NodeInput = [number | undefined];

export class Loop extends Process {
    override run(node: Node, env: TreeEnv): Status {
        let [count] = env.input as NodeInput;
        count = count ?? (node.args as NodeArgs).count;

        let last = node.resume(env);
        let i = 0;
        let j = 0;

        if (last instanceof Array) {
            if (env.status === "running") {
                node.error(`unexpected status error`);
            }

            i = last[0];
            j = last[1] + 1;
            if (j >= node.children.length) {
                i++;
                j = 0;
            }
        }

        for (; i < count; i++) {
            for (; j < node.children.length; j++) {
                const status = node.children[j].run(env);
                if (status === "running") {
                    if (last instanceof Array) {
                        last[0] = i;
                        last[1] = j;
                    } else {
                        last = [i, j];
                    }
                    return node.yield(env, last);
                }
            }
            j = 0;
        }
        return "success";
    }

    override get descriptor(): NodeDef {
        return {
            name: "Loop",
            type: "Composite",
            desc: "循环执行",
            input: ["循环次数?"],
            args: [{ name: "count", type: "int?", desc: "循环次数" }],
        };
    }
}
