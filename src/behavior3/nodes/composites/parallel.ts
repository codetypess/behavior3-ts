import { Node, NodeDef } from "../../node";
import { Process, Status } from "../../process";
import { TreeEnv } from "../../tree-env";

const EMPTY: Node[] = [];

export class Parallel extends Process {
    override run(node: Node, env: TreeEnv): Status {
        const last = (node.resume(env) as Node[][]) ?? [];
        const level = env.stack.length;
        let count = 0;

        node.children.forEach((child, idx) => {
            let nodes = last[idx];
            let status: Status | undefined;
            if (nodes === undefined) {
                status = child.run(env);
            } else if (nodes.length > 0) {
                for (let i = nodes.length - 1; i >= 0; i--) {
                    child = nodes[i];
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
                    nodes = env.stack.splice(level, env.stack.length - level);
                }
            } else {
                nodes = EMPTY;
                count++;
            }

            last[idx] = nodes;
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
            doc: `
                + 并行执行所有子节点
                + 当有子节点返回「运行中」时，返回「运行中」状态
                + 执行完所有子节点后，返回「成功」`,
        };
    }
}
