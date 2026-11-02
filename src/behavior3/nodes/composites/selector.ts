import { type Context } from "../../context";
import { Node, NodeDef, Status } from "../../node";
import { registerNode } from "../../register-node";
import { Tree } from "../../tree";

/**
 * Selector composite node that executes children in order.
 * Returns:
 * - `success`: if any child returns `success`
 * - `failure`: when all children return `failure`
 * - `running`: if a child returns `running`
 *
 * Executes children sequentially until one succeeds or all fail.
 * If a child returns `running`, the selector will yield and resume
 * from that child on next tick.
 */
@registerNode
export class Selector extends Node {
    override onTick(tree: Tree<Context, unknown>): Status {
        const children = this.children;
        let i = tree.getState<number>(this);
        let conditionsChecked = false;

        if (i === undefined) {
            i = 0;
        } else {
            const k = this._checkPreempt(tree, i);
            if (k !== i) {
                children[i].abort(tree);
                i = k;
                conditionsChecked = true;
            }
        }

        for (; i < children.length; i++) {
            const status = children[i].tick(tree, conditionsChecked);
            conditionsChecked = false;
            if (status === "success") {
                return "success";
            } else if (status === "running") {
                tree.setState(this, i);
                return "running";
            } else if (status === "error") {
                return "error";
            }
        }

        return "failure";
    }

    static override get descriptor(): NodeDef {
        return {
            name: "Selector",
            type: "Composite",
            group: ["Core"],
            children: -1,
            preemptive: true,
            desc: "选择执行",
            status: ["|success", "&failure", "|running"],
            doc: `
                + 一直往下执行，直到有子节点返回 \`success\` 则返回 \`success\`
                + 若全部节点返回 \`failure\` 则返回 \`failure\`
                + 子节点的条件配置了 \`lower\` 或 \`both\` 时，右侧的子节点运行中，每次执行都会检查它的条件，满足则打断右侧的子节点，转而执行它`,
        };
    }
}
