import { type Context } from "../../context";
import { Node, NodeDef, Status } from "../../node";
import { registerNode } from "../../register-node";
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
@registerNode
export class IfElse extends Node {
    override onTick(tree: Tree<Context, unknown>): Status {
        const children = this.children;
        let i = tree.getState<number>(this) ?? 0;

        if (i === 0) {
            const status = children[0].tick(tree);
            if (status === "running") {
                tree.setState(this, 0);
                return "running";
            } else if (status === "error") {
                return "error";
            }
            i = status === "success" ? 1 : 2;
        }

        const status = children[i].tick(tree);
        if (status === "running") {
            tree.setState(this, i);
        }
        return status;
    }

    static override get descriptor(): NodeDef {
        return {
            name: "IfElse",
            type: "Composite",
            group: ["Core"],
            children: 3,
            status: ["|success", "|failure", "|running"],
            desc: "根据条件执行两个分支之一",
            doc: `
                + 必须有三个子节点：条件、成功分支、失败分支
                + 先执行条件，返回 \`success\` 时执行成功分支，返回 \`failure\` 时执行失败分支
                + 返回所执行分支的状态
                + 条件返回 \`error\` 时，不执行任何分支，返回 \`error\`
            `,
        };
    }
}
