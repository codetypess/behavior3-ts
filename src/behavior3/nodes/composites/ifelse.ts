import type { Context, DeepReadonly } from "../../context";
import { Node, NodeDef, Status } from "../../node";
import { Tree } from "../../tree";

export class IfElse extends Node {
    private _ifelse(tree: Tree<Context, unknown>, status: Exclude<Status, "running">) {
        const i = status === "success" ? 1 : 2;
        const childStatus = this.children[i].tick(tree);
        if (childStatus === "running") {
            return tree.yield(this, i);
        } else {
            return childStatus;
        }
    }

    override onTick(tree: Tree<Context, unknown>): Status {
        const i: number | undefined = tree.resume(this);
        const lastNodeStatus = tree.lastNodeStatus;
        if (i !== undefined) {
            if (lastNodeStatus === "running") {
                this.error(`unexpected status error`);
            } else if (i === 0) {
                return this._ifelse(tree, lastNodeStatus);
            } else {
                return lastNodeStatus;
            }
            return "failure";
        }

        const status = this.children[0].tick(tree);
        if (status === "running") {
            return tree.yield(this, 0);
        } else {
            return this._ifelse(tree, status);
        }
    }

    get descriptor(): DeepReadonly<NodeDef> {
        return {
            name: "IfElse",
            type: "Composite",
            children: 3,
            status: ["|success", "|failure", "|running"],
            desc: "条件执行",
            doc: `
                + 必须有三个子节点
                + 第一个子节点为条件节点
                + 第二个子节点为条件为 \`success\` 时执行的节点
                + 第三个子节点为条件为 \`failure\` 时执行的节点,
            `,
        };
    }
}
