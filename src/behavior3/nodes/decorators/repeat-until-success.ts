import { Node, NodeDef } from "../../node";
import { Process, Status } from "../../process";
import { TreeEnv } from "../../tree-env";

interface NodeArgs {
    readonly maxLoop?: number;
}

export class RepeatUntilSuccess extends Process {
    override tick(node: Node, env: TreeEnv): Status {
        const args = node.args as unknown as NodeArgs;
        const maxLoop = this._checkOneof(node, env, 0, args.maxLoop, Number.MAX_SAFE_INTEGER);
        let count = node.resume(env) as number | undefined;

        if (typeof count === "number") {
            if (env.status === "success") {
                return "success";
            } else if (count >= maxLoop) {
                return "failure";
            } else {
                count++;
            }
        } else {
            count = 1;
        }

        const status = node.children[0].tick(env);
        if (status === "success") {
            return "success";
        } else {
            return node.yield(env, count);
        }
    }

    override get descriptor(): NodeDef {
        return {
            name: "RepeatUntilSuccess",
            type: "Decorator",
            children: 1,
            status: ["|success", "|failure", "|running"],
            desc: "一直尝试直到子节点返回成功",
            input: ["最大循环次数?"],
            args: [
                {
                    name: "maxLoop",
                    type: "int?",
                    desc: "最大循环次数",
                },
            ],
            doc: `
                + 只能有一个子节点，多个仅执行第一个
                + 只有当子节点返回 \`success\` 时，才返回 \`success\`，其它情况返回 \`running\` 状态
                + 如果设定了尝试次数，超过指定次数则返回 \`failure\``,
        };
    }
}
