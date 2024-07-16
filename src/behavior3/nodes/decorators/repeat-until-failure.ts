import { Node, NodeDef } from "../../node";
import { Process, Status } from "../../process";
import { TreeEnv } from "../../tree-env";

interface NodeArgs {
    readonly maxLoop?: number;
}

type NodeInput = [number | undefined];

export class RepeatUntilFailure extends Process {
    override init(node: Node) {
        this._checkOneChild(node);
    }

    override run(node: Node, env: TreeEnv): Status {
        let [maxLoop] = env.input as NodeInput;
        const args = node.args as unknown as NodeArgs;
        maxLoop = maxLoop ?? args.maxLoop ?? Number.MAX_SAFE_INTEGER;

        let count = node.resume(env) as number | undefined;

        if (typeof count === "number") {
            if (env.status === "failure") {
                return "success";
            } else if (count >= maxLoop) {
                return "failure";
            } else {
                count++;
            }
        } else {
            count = 1;
        }

        const status = node.children[0].run(env);
        if (status === "failure") {
            return "success";
        } else {
            return node.yield(env, count);
        }
    }

    override get descriptor(): NodeDef {
        return {
            name: "RepeatUntilFailure",
            type: "Decorator",
            status: ["!success", "!failure", "|running"],
            desc: "一直尝试直到子节点返回失败",
            input: ["最大循环次数?"],
            args: [{ name: "maxLoop", type: "int?", desc: "最大循环次数" }],
            doc: `
                + 只能有一个子节点，多个仅执行第一个
                + 只有当子节点返回\`失败\`时，才返回\`成功\`，其它情况返回\`运行中\`状态
                + 如果设定了尝试次数，超过指定次数则返回\`失败\``,
        };
    }
}
