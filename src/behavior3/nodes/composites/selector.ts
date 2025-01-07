import type { Context, DeepReadonly } from "../../context";
import { Node, NodeDef, Status } from "../../node";
import { Tree } from "../../tree";

export class Selector extends Node {
    override onTick(tree: Tree<Context, unknown>): Status {
        const last: number | undefined = tree.resume(this);
        const children = this.children;
        const lastNodeStatus = tree.lastNodeStatus;
        let i = 0;

        if (typeof last === "number") {
            if (lastNodeStatus === "failure") {
                i = last + 1;
            } else if (lastNodeStatus === "success") {
                return "success";
            } else {
                this.error(`unexpected status error`);
            }
        }

        for (; i < children.length; i++) {
            const status = children[i].tick(tree);
            if (status === "success") {
                return "success";
            } else if (status === "running") {
                return tree.yield(this, i);
            }
        }

        return "failure";
    }

    get descriptor(): DeepReadonly<NodeDef> {
        return {
            name: "Selector",
            type: "Composite",
            children: -1,
            desc: "选择执行",
            status: ["|success", "&failure", "|running"],
            doc: `
                + 一直往下执行，直到有子节点返回 \`success\` 则返回 \`success\`
                + 若全部节点返回 \`failure\` 则返回 \`failure\``,
        };
    }
}
