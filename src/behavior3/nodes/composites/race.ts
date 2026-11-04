import { type Context } from "../../context";
import { Node, NodeDef, Status } from "../../node";
import { registerNode } from "../../register-node";
import { Tree } from "../../tree";

/**
 * Race node executes all child nodes simultaneously until one succeeds or all fail.
 *
 * The execution flow is:
 * 1. Execute all child nodes in parallel
 * 2. If any child returns `success`, immediately return `success` and cancel other running children
 * 3. If any child returns `running`, store its state and continue next tick
 * 4. Return `failure` only when all children have failed
 *
 * Each child's execution state is tracked independently, allowing parallel execution.
 * The first child to succeed "wins the race" and causes the node to succeed.
 * The node only fails if all children fail.
 */
@registerNode
export class Race extends Node {
    override onTick(tree: Tree<Context, unknown>): Status {
        const children = this.children;
        const failed = tree.getState<boolean[]>(this) ?? [];
        let count = 0;

        for (let i = 0; i < children.length; i++) {
            if (!failed[i]) {
                const status = children[i].tick(tree);
                if (status === "success" || status === "error") {
                    // the other running children are aborted when this node finishes
                    return status;
                } else if (status !== "running") {
                    failed[i] = true;
                }
            }
            if (failed[i]) {
                count++;
            }
        }

        if (count === children.length) {
            return "failure";
        } else {
            tree.setState(this, failed);
            return "running";
        }
    }

    static override get descriptor(): NodeDef {
        return {
            name: "Race",
            type: "Composite",
            group: ["Core"],
            status: ["|success", "&failure", "|running"],
            children: -1,
            desc: "并行执行所有子节点，任一成功即成功",
            doc: `
                + 每次执行时，依次执行所有还没失败的子节点
                + 有子节点返回 \`success\` 时，立即返回 \`success\`，并中止其他还在运行的子节点
                + 所有子节点都返回 \`failure\` 时，返回 \`failure\`
                + 有子节点返回 \`error\` 时，立即返回 \`error\``,
        };
    }
}
