import { type Context } from "../../context";
import { Node, NodeDef, Status } from "../../node";
import { registerNode } from "../../register-node";
import { Tree } from "../../tree";

/**
 * Parallel node executes all child nodes simultaneously.
 *
 * The execution flow is:
 * 1. Execute all child nodes in parallel
 * 2. If any child returns `running`, store its state and continue next tick
 * 3. Return `running` until all children complete
 * 4. When all children complete, return `success`
 *
 * Each child's execution state is tracked independently, allowing true parallel behavior.
 * The node only succeeds when all children have completed successfully.
 */
@registerNode
export class Parallel extends Node {
    override onTick(tree: Tree<Context, unknown>): Status {
        const children = this.children;
        const done = tree.getState<boolean[]>(this) ?? [];
        let count = 0;

        for (let i = 0; i < children.length; i++) {
            if (!done[i] && children[i].tick(tree) !== "running") {
                done[i] = true;
            }
            if (done[i]) {
                count++;
            }
        }

        if (count === children.length) {
            return "success";
        } else {
            tree.setState(this, done);
            return "running";
        }
    }

    static override get descriptor(): NodeDef {
        return {
            name: "Parallel",
            type: "Composite",
            status: ["success", "|running"],
            children: -1,
            desc: "并行执行",
            doc: `
                + 并行执行所有子节点
                + 当有子节点返回 \`running\` 时，返回 \`running\` 状态
                + 执行完所有子节点后，返回 \`success\``,
        };
    }
}
