import { type Context } from "../../context";
import { Node, NodeDef, Status } from "../../node";
import { registerNode } from "../../register-node";
import { Tree } from "../../tree";

@registerNode
export class RetryUntilFailure extends Node {
    declare args: { readonly count?: number };

    override onTick(tree: Tree<Context, unknown>, input: readonly unknown[]): Status {
        const child = this.children[0];
        const maxTryTimes = this._checkOneof(input, 0, this.args.count, Number.MAX_SAFE_INTEGER);
        let count = tree.getState<number>(this);
        const resumed = count !== undefined && tree.isRunning(child);

        if (count === undefined) {
            count = 1;
        } else if (!resumed) {
            // the last try succeeded in the previous tick, try again
            if (count >= maxTryTimes) {
                return "failure";
            }
            count++;
        }

        let status = child.tick(tree);
        if (resumed && status === "success") {
            // the running try has just finished, try again immediately
            if (count >= maxTryTimes) {
                return "failure";
            }
            count++;
            status = child.tick(tree);
        }

        if (status === "failure") {
            return "success";
        } else if (status === "error") {
            return "error";
        } else {
            tree.setState(this, count);
            return "running";
        }
    }

    static override get descriptor(): NodeDef {
        return {
            name: "RetryUntilFailure",
            type: "Decorator",
            group: ["Core"],
            children: 1,
            status: ["!success", "failure", "running"],
            desc: "重试子节点，直到它返回失败",
            input: ["最大尝试次数?"],
            args: [
                {
                    name: "count",
                    type: "int?",
                    desc: "最大尝试次数",
                    oneof: "最大尝试次数",
                },
            ],
            doc: `
                + 只能有一个子节点，多个仅执行第一个
                + 子节点返回 \`failure\` 时，返回 \`success\`
                + 子节点返回 \`success\` 时，下次执行再试一次，期间返回 \`running\`
                + 子节点返回 \`error\` 时，返回 \`error\`，不再重试
                + 尝试了 \`最大尝试次数\` 次子节点仍然没有返回 \`failure\` 时，返回 \`failure\`；没有配置时不限次数`,
        };
    }
}
