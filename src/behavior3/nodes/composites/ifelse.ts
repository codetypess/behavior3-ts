import type { Context } from "../../context";
import { Node, NodeDef, Status } from "../../node";
import { Tree } from "../../tree";

/**
 * IfElse node executes different child nodes based on a condition.
 *
 * The node requires exactly 3 children:
 * 1. The condition node that determines which branch to execute
 * 2. The node to execute if condition returns `success`
 * 3. The node to execute if condition returns `failure`
 *
 * The execution flow is:
 * 1. Execute condition node (first child)
 * 2. If condition returns `success`, execute second child
 * 3. If condition returns `failure`, execute third child
 * 4. Return the status of whichever branch was executed
 */
export class IfElse extends Node {
    private _ifelse(tree: Tree<Context, unknown>, status: Exclude<Status, "running">) {
        if (status === "error") {
            return "error";
        }
        const i = status === "success" ? 1 : 2;
        const childStatus = this.children[i].tick(tree);
        if (childStatus === "running") {
            return tree.yield(this, i);
        } else {
            return childStatus;
        }
    }

    override onTick(tree: Tree<Context, unknown>, status: Status): Status {
        const i: number | undefined = tree.resume(this);
        if (i !== undefined) {
            if (status === "running") {
                this.throw(`unexpected status error`);
            } else if (i === 0) {
                return this._ifelse(tree, status);
            } else {
                return status;
            }
        }

        status = this.children[0].tick(tree);
        if (status === "running") {
            return tree.yield(this, 0);
        } else {
            return this._ifelse(tree, status);
        }
    }

    static override get descriptor(): NodeDef {
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
