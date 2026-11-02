import { type Context } from "../../context";
import { Node, NodeData, NodeDef, Status } from "../../node";
import { registerNode } from "../../register-node";
import { Tree } from "../../tree";

/**
 * Parallel node executes all child nodes every tick until the result is decided.
 *
 * With `successCount` (all children by default):
 * + `success`: as soon as `successCount` children have succeeded
 * + `failure`: as soon as so many children have failed that `successCount` can't be reached
 * + `error`: as soon as a child returns `error`
 * + `running`: otherwise, the finished children are not ticked again
 *
 * The children still running are aborted when this node finishes.
 */
@registerNode
export class Parallel extends Node {
    declare args: { readonly successCount?: number };

    constructor(context: Context, cfg: NodeData) {
        super(context, cfg);

        const count = this.args.successCount;
        if (
            count !== undefined &&
            (!Number.isInteger(count) || count < 1 || count > this.children.length)
        ) {
            this.throw(`successCount must be in [1, ${this.children.length}]: ${count}`);
        }
    }

    override onTick(tree: Tree<Context, unknown>): Status {
        const children = this.children;
        const successCount = this.args.successCount ?? children.length;
        // the maximum number of failed children while successCount is still reachable
        const failureCount = children.length - successCount;
        const results = tree.getState<Status[]>(this) ?? [];
        let succeeded = 0;
        let failed = 0;

        for (let i = 0; i < children.length; i++) {
            if (results[i] === undefined) {
                const status = children[i].tick(tree);
                if (status === "error") {
                    return "error";
                } else if (status !== "running") {
                    results[i] = status;
                }
            }
            if (results[i] === "success" && ++succeeded >= successCount) {
                return "success";
            } else if (results[i] === "failure" && ++failed > failureCount) {
                return "failure";
            }
        }

        if (succeeded >= successCount) {
            // no children
            return "success";
        }
        tree.setState(this, results);
        return "running";
    }

    static override get descriptor(): NodeDef {
        return {
            name: "Parallel",
            type: "Composite",
            status: ["|success", "|failure", "|running"],
            children: -1,
            desc: "并行执行",
            args: [
                {
                    name: "successCount",
                    type: "int?",
                    desc: "成功数量（达到即成功，默认全部）",
                },
            ],
            doc: `
                + 每次执行时，执行所有还没结束的子节点
                + 成功的子节点达到 \`successCount\`（默认全部子节点）时，立即返回 \`success\`
                + 失败的子节点多到不可能达到 \`successCount\` 时，立即返回 \`failure\`
                + 有子节点返回 \`error\` 时，立即返回 \`error\`
                + 返回时中止其他还在运行的子节点`,
        };
    }
}
