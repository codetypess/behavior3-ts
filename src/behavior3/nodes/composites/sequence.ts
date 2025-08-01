import type { Context } from "../../context";
import { Node, NodeDef, Status } from "../../node";

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
export class Sequence extends Node {
    override onTick(tree: Tree<Context, unknown>, status: Status): Status {
        const last: number | undefined = tree.resume(this);
        const children = this.children;
        let i = 0;

        if (typeof last === "number") {
            if (status === "success") {
                i = last + 1;
            } else if (status === "failure" || status === "error") {
                return status;
            } else {
                this.throw(`unexpected status error: ${status}`);
            }
        }

        for (; i < children.length; i++) {
            status = children[i].tick(tree);
            if (status === "failure" || status === "error") {
                return status;
            } else if (status === "running") {
                return tree.yield(this, i);
            }
        }

        return "success";
    }

    static override get descriptor(): NodeDef {
        return {
            name: "Sequence",
            type: "Composite",
            children: -1,
            status: ["&success", "|failure", "|running"],
            desc: "顺序执行",
            doc: `
                + 一直往下执行，只有当所有子节点都返回 \`success\`, 才返回 \`success\`
                + 若子节点返回 \`failure\`，则直接返回 \`failure\` 状态
                + 其余情况返回 \`running\` 状态
            `,
        };
    }
}
