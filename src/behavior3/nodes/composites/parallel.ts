import { Node, NodeDef } from "../../node";
import { Process, Status } from "../../process";
import { TreeEnv } from "../../tree-env";

const EMPTY: Node[] = [];

export class Parallel extends Process {
    override run(node: Node, env: TreeEnv): Status {
        const last = (node.resume(env) as Node[][]) ?? [];
        const level = env.stack.length;
        let count = 0;

        node.children.forEach((child, i) => {
            let nodes = last.at(i);
            let status: Status | undefined;
            if (nodes === undefined) {
                status = child.run(env);
            } else if (nodes.length > 0) {
                for (let j = nodes.length - 1; j >= 0; j--) {
                    child = nodes[j];
                    env.stack.push(child);
                    status = child.run(env);
                    if (status === "running") {
                        env.stack.pop();
                        break;
                    } else {
                        nodes.pop();
                    }
                }
            } else {
                status = "success";
            }

            if (status === "running") {
                if (nodes === undefined) {
                    nodes = [];
                    for (let j = env.stack.length - level - 1; j >= 0; j--) {
                        nodes[j] = env.stack.pop()!;
                    }
                }
            } else {
                nodes = EMPTY;
                count++;
            }

            last[i] = nodes;
        });

        if (count === node.children.length) {
            return "success";
        } else {
            return node.yield(env, last);
        }
    }

    override get descriptor(): NodeDef {
        return {
            name: "Parallel",
            type: "Composite",
            desc: "并行执行",
            doc: `执行所有子节点并返回「成功」/「运行中」`,
        };
    }
}
