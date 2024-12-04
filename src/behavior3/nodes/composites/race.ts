import { Node } from "../../node";
import { Process, Status } from "../../process";
import { Stack, TreeEnv } from "../../tree-env";

const EMPTY_STACK: Stack = new Stack(null!);

export class Race extends Process {
    constructor() {
        super({
            name: "Race",
            type: "Composite",
            status: ["|success", "&failure", "|running"],
            children: -1,
            desc: "竞争执行",
            doc: `
                + 并行执行所有子节点
                + 当有子节点返回 \`success\` 时，立即返回 \`success\` 状态，并中断其他子节点
                + 如果所有子节点返回 \`failure\` 则返回 \`failure\``,
        });
    }

    override tick(node: Node, env: TreeEnv): Status {
        const last: Stack[] = node.resume(env) ?? [];
        const level = env.stack.length;
        let count = 0;

        for (let i = 0; i < node.children.length; i++) {
            let child = node.children[i];
            let stack = last[i];
            let status: Status = "failure";
            if (stack === undefined) {
                status = child.tick(env);
            } else if (stack.length > 0) {
                stack.move(env.stack, 0, stack.length);
                while (env.stack.length > level) {
                    child = env.stack.top()!;
                    status = child.tick(env);
                    if (status === "running") {
                        break;
                    }
                }
            }

            if (status === "running") {
                if (stack === undefined) {
                    stack = new Stack(env);
                }
                env.stack.move(stack, level, env.stack.length - level);
            } else if (status === "success") {
                last.forEach((v) => v !== EMPTY_STACK && v.clear());
                return "success";
            } else {
                count++;
                stack = EMPTY_STACK;
            }

            last[i] = stack;
        }

        if (count === node.children.length) {
            return "failure";
        } else {
            return node.yield(env, last);
        }
    }
}
