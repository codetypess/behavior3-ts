import { Node, NodeDef } from "../../node";
import { Process, Status } from "../../process";
import { Stack, TreeEnv } from "../../tree-env";

const EMPTY = new Stack(null!);

export class Parallel extends Process {
    override run(node: Node, env: TreeEnv): Status {
        const last = (node.resume(env) as Stack[]) ?? [];
        const level = env.stack.length;
        let count = 0;

        node.children.forEach((child, idx) => {
            let stack = last[idx];
            let status: Status | undefined;
            if (stack === undefined) {
                status = child.run(env);
            } else if (stack.length > 0) {
                for (let i = stack.length - 1; i >= 0; i--) {
                    child = stack.get(i)!;
                    env.stack.push(child);
                    status = child.run(env);
                    if (status === "running") {
                        env.stack.pop(false);
                        break;
                    } else {
                        stack.pop();
                    }
                }
            } else {
                status = "success";
            }

            if (status === "running") {
                if (stack === undefined) {
                    stack = env.stack.take(level, env.stack.length - level);
                }
            } else {
                stack = EMPTY;
                count++;
            }

            last[idx] = stack;
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
            status: ["success", "|running"],
            children: -1,
            desc: "并行执行",
            doc: `
                + 并行执行所有子节点
                + 当有子节点返回\`running\`时，返回\`running\`状态
                + 执行完所有子节点后，返回\`success\``,
        };
    }
}
