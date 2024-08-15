import { Node, NodeDef } from "../../node";
import { Process, Status } from "../../process";
import { Stack, TreeEnv } from "../../tree-env";

const EMPTY_STACK: Stack = new Stack(null!);

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
                stack.move(env.stack, 0, stack.length);
                while (env.stack.length > level) {
                    child = env.stack.top()!;
                    status = child.run(env);
                    if (status === "running") {
                        break;
                    }
                }
            } else {
                status = "success";
            }

            if (status === "running") {
                if (stack === undefined) {
                    stack = new Stack(env);
                }
                env.stack.move(stack, level, env.stack.length - level);
            } else {
                count++;
                stack = EMPTY_STACK;
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
                + 当有子节点返回 \`running\` 时，返回 \`running\` 状态
                + 执行完所有子节点后，返回 \`success\``,
        };
    }
}
