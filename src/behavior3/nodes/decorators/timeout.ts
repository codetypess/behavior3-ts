import { Context } from "../../context";
import { Node, NodeDef } from "../../node";
import { Process, Status } from "../../process";
import { TreeEnv } from "../../tree-env";

interface NodeArgs {
    readonly time: number;
}

interface NodeYield {
    nodes: Node[];
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
            return "failure";
        } else {
            for (let i = last.nodes.length - 1; i >= 0; i--) {
                const child = last.nodes[i];
                env.stack.push(child);
                status = child.run(env);
                if (status === "running") {
                    env.stack.pop();
                    break;
                } else {
                    last.nodes.pop();
                }
            }
        }

        if (status === "running") {
            if (last === undefined) {
                const args = node.args as unknown as NodeArgs;
                last = {
                    nodes: env.stack.splice(level, env.stack.length - level),
                    expired: env.context.time + args.time,
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
            desc: "超时",
            args: [{ name: "time", type: "float", desc: "超时时间" }],
            doc: `
                + 只能有一个子节点，多个仅执行第一个
                + 当子节点执行超时或返回「失败」时，返回「失败」
                + 其余情况返回子节点的执行状态
            `,
        };
    }
}
