import type { Context } from "../../context";
import { Node, NodeDef, Status } from "../../node";
import { Tree } from "../../tree";

export class RetryUntilFailure extends Node {
    declare args: { readonly count?: number };

    override onTick(tree: Tree<Context, unknown>, status: Status): Status {
        const maxTryTimes = this._checkOneof(0, this.args.count, Number.MAX_SAFE_INTEGER);
        let count: number | undefined = tree.resume(this);

        if (typeof count === "number") {
            if (status === "error") {
                return "error";
            } else if (status === "failure") {
                return "success";
            } else if (count >= maxTryTimes) {
                return "failure";
            } else {
                count++;
            }
        } else {
            count = 1;
        }

        status = this.children[0].tick(tree);
        if (status === "error") {
            return "error";
        } else if (status === "failure") {
            return "success";
        } else {
            return tree.yield(this, count);
        }
    }

    static override get descriptor(): NodeDef {
        return {
            name: "RetryUntilFailure",
            type: "Decorator",
            children: 1,
            status: ["!success", "failure", "running"],
            desc: "一直尝试直到子节点返回失败",
            input: ["最大尝试次数?"],
            args: [
                {
                    name: "count",
                    type: "int?",
                    desc: "最大尝试次数",
                },
            ],
            doc: `
                + 只能有一个子节点，多个仅执行第一个
                + 只有当子节点返回 \`failure\` 时，才返回 \`success\`，其它情况返回 \`running\` 状态
                + 如果设定了尝试次数，超过指定次数则返回 \`failure\``,
        };
    }
}
