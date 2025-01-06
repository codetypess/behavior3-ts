import type { Context, DeepReadonly } from "../../context";
import { Node, NodeDef, Status } from "../../node";

import { Tree } from "../../tree";

export class Sequence extends Node {
    override onTick(tree: Tree<Context, unknown>): Status {
        const last: number | undefined = tree.resume(this);
        let i = 0;

        if (typeof last === "number") {
            if (tree.lastNodeStatus === "success") {
                i = last + 1;
            } else if (tree.lastNodeStatus === "failure") {
                return "failure";
            } else {
                this.error(`unexpected status error: ${tree.lastNodeStatus}`);
            }
        }

        for (; i < this.children.length; i++) {
            const status = this.children[i].tick(tree);
            if (status === "failure") {
                return "failure";
            } else if (status === "running") {
                return tree.yield(this, i);
            }
        }

        return "success";
    }

    get descriptor(): DeepReadonly<NodeDef> {
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
