import { type Context } from "../../context";
import { Node, NodeDef, Status } from "../../node";
import { registerNode } from "../../register-node";
import { Tree } from "../../tree";

/**
 * Sequence composite node that executes children in order.
 * Returns:
 * - `success`: when all children return `success`
 * - `failure`: if any child returns `failure`
 * - `running`: if a child returns `running`
 *
 * Executes children sequentially until one fails or all succeed.
 * If a child returns `running`, the sequence will yield and resume
 * from that child on next tick.
 */
@registerNode
export class Sequence extends Node {
    override onTick(tree: Tree<Context, unknown>): Status {
        const children = this.children;
        let i = tree.getState<number>(this) ?? 0;

        for (; i < children.length; i++) {
            const status = children[i].tick(tree);
            if (status === "failure" || status === "error") {
                return status;
            } else if (status === "running") {
                tree.setState(this, i);
                return "running";
            }
        }

        return "success";
    }

    static override get descriptor(): NodeDef {
        return {
            name: "Sequence",
            type: "Composite",
            group: ["Core"],
            children: -1,
            status: ["&success", "|failure", "|running"],
            desc: "依次执行子节点，直到有一个失败",
            doc: `
                + 从上到下执行子节点，所有子节点都返回 \`success\` 时，返回 \`success\`
                + 子节点返回 \`failure\` 或 \`error\` 时，立即返回该状态，不再执行后面的子节点
                + 子节点返回 \`running\` 时返回 \`running\`，下次从这个子节点继续执行
            `,
        };
    }
}
