import { type Context } from "../../context";
import { Node, NodeDef, Status } from "../../node";
import { registerNode } from "../../register-node";
import { Stack } from "../../stack";
import { Tree } from "../../tree";

@registerNode
export class Watchdog extends Node {
    override onTick(tree: Tree<Context, unknown>, status: Status): Status {
        let last: Stack | undefined = tree.resume(this);
        const level = tree.stack.length;

        const lastStatus = tree.__lastStatus;
        status = this.children[0].tick(tree);
        tree.__lastStatus = lastStatus;
        if (status === "running") {
            this.error("unexpected status error: running");
            return "error";
        } else if (status === "error") {
            return status;
        }

        if (status === "failure") {
            this.children[2].tick(tree);
            tree.stack.popTo(level);
            return "failure";
        } else if (last === undefined) {
            status = this.children[1].tick(tree);
        } else {
            last.move(tree.stack, 0, last.length);
            while (tree.stack.length > level) {
                const child = tree.stack.top()!;
                status = child.tick(tree);
                if (status === "running") {
                    break;
                }
            }
        }

        if (status === "running") {
            if (last === undefined) {
                last = new Stack(tree);
            }
            tree.stack.move(last, level, tree.stack.length - level);
            return tree.yield(this, last);
        } else {
            return status;
        }
    }

    static override get descriptor(): NodeDef {
        return {
            name: "Watchdog",
            type: "Composite",
            children: 3,
            status: ["|success", "|failure", "|running"],
            desc: "测试执行",
            doc: `
                + 必须有3个子节点
                + 第一个子节点为条件节点，返回 \`success\` 或 \`failure\` 状态
                + 第二个子节点为条件为 \`success\` 时执行的节点
                + 第三个子节点为条件为 \`failure\` 时执行的节点，不管子节点返回什么状态，都直接返回 \`failure\`
                + 当第二个子节点返回 \`running\` 时，由本节点维护其运行状态
                + 每一次 tick 都会先执行测试节点，只有当测试节点返回 \`success\`，才执行第二个子节点
            `,
        };
    }
}
