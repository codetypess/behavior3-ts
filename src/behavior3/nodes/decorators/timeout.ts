import { Node } from "../../node";
import { Process, Status } from "../../process";
import { Stack, TreeEnv } from "../../tree-env";

interface NodeArgs {
    readonly time?: number;
}

interface NodeYield {
    stack: Stack;
    expired: number;
}

export class Timeout extends Process {
    constructor() {
        super({
            name: "Timeout",
            type: "Decorator",
            children: 1,
            status: ["|success", "|running", "failure"],
            desc: "超时",
            input: ["超时时间?"],
            args: [
                {
                    name: "time",
                    type: "float?",
                    desc: "超时时间",
                    oneof: "超时时间",
                },
            ],
            doc: `
                + 只能有一个子节点，多个仅执行第一个
                + 当子节点执行超时或返回 \`failure\` 时，返回 \`failure\`
                + 其余情况返回子节点的执行状态
            `,
        });
    }

    override tick(node: Node, env: TreeEnv): Status {
        const level = env.stack.length;
        let last: NodeYield | undefined = node.resume(env);
        let status: Status = "failure";
        if (last === undefined) {
            status = node.children[0].tick(env);
        } else if (env.context.time >= last.expired) {
            last.stack.clear();
            return "failure";
        } else {
            last.stack.move(env.stack, 0, last.stack.length);
            while (env.stack.length > level) {
                const child = env.stack.top()!;
                status = child.tick(env);
                if (status === "running") {
                    break;
                }
            }
        }

        if (status === "running") {
            if (last === undefined) {
                const arg = node.args as unknown as NodeArgs;
                const time = this._checkOneof(node, env, 0, arg.time, 0);
                last = {
                    stack: new Stack(env),
                    expired: env.context.time + time,
                };
            }
            env.stack.move(last.stack, level, env.stack.length - level);
            return node.yield(env, last);
        } else {
            return status;
        }
    }
}
