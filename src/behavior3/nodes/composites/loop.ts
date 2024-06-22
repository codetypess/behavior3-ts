import { Node, NodeDef } from "../../node";
import { Process, Status } from "../../process";
import { TreeEnv } from "../../tree-env";

interface NodeArgs {
    readonly count: number;
}

type NodeInput = [number | undefined];

export class Loop extends Process {
    override run(node: Node, env: TreeEnv): Status {
        let [count] = env.input as NodeInput;
        const args = node.args as unknown as NodeArgs;
        count = count ?? args.count;

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
                } else if (status === "failure") {
                    return "failure";
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
            args: [{ name: "count", type: "int", desc: "循环次数" }],
            doc: `
                + 对所有的子节点循环执行指定次数
                + 当子节点返回「运行中」时，返回「运行中」状态
                + 当子节点返回「失败」时，退出遍历并返回「失败」状态
                + 执行完所有子节点后，返回「成功」
            `,
        };
    }
}
