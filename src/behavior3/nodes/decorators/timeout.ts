import { Node, NodeDef } from "../../node";
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
    override run(node: Node, env: TreeEnv): Status {
        const level = env.stack.length;
        let last = node.resume(env) as NodeYield | undefined;
        let status: Status = "failure";
        if (last === undefined) {
            status = node.children[0].run(env);
        } else if (env.context.time >= last.expired) {
            last.stack.clear();
            return "failure";
        } else {
            for (let i = last.stack.length - 1; i >= 0; i--) {
                const child = last.stack.get(i)!;
                env.stack.push(child);
                status = child.run(env);
                if (status === "running") {
                    env.stack.pop(false);
                    break;
                } else {
                    last.stack.pop();
                }
            }
        }

        if (status === "running") {
            if (last === undefined) {
                const arg = node.args as unknown as NodeArgs;
                const time = this._checkOneof(node, env, 0, arg.time, 0);
                last = {
                    stack: env.stack.take(level, env.stack.length - level),
                    expired: env.context.time + time,
                };
            }
            return node.yield(env, last);
        } else {
            return status;
        }
    }

    override get descriptor(): NodeDef {
        return {
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
                + 当子节点执行超时或返回\`failure\`时，返回\`failure\`
                + 其余情况返回子节点的执行状态
            `,
        };
    }
}
