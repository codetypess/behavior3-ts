import type { Context, DeepReadonly } from "../../context";
import { Node, NodeDef, Status } from "../../node";
import { Stack } from "../../stack";
import { Tree } from "../../tree";

const EMPTY_STACK: Stack = new Stack(null!);

export class Race extends Node {
    override onTick(tree: Tree<Context, unknown>): Status {
        const last: Stack[] = tree.resume(this) ?? [];
        const level = tree.stack.length;
        let count = 0;

        for (let i = 0; i < this.children.length; i++) {
            let child = this.children[i];
            let stack = last[i];
            let status: Status = "failure";
            if (stack === undefined) {
                status = child.tick(tree);
            } else if (stack.length > 0) {
                stack.move(tree.stack, 0, stack.length);
                while (tree.stack.length > level) {
                    child = tree.stack.top()!;
                    status = child.tick(tree);
                    if (status === "running") {
                        break;
                    }
                }
            }

            if (status === "running") {
                if (stack === undefined) {
                    stack = new Stack(tree);
                }
                tree.stack.move(stack, level, tree.stack.length - level);
            } else if (status === "success") {
                last.forEach((v) => v !== EMPTY_STACK && v.clear());
                return "success";
            } else {
                count++;
                stack = EMPTY_STACK;
            }

            last[i] = stack;
        }

        if (count === this.children.length) {
            return "failure";
        } else {
            return tree.yield(this, last);
        }
    }

    get descriptor(): DeepReadonly<NodeDef> {
        return {
            name: "Race",
            type: "Composite",
            status: ["|success", "&failure", "|running"],
            children: -1,
            desc: "竞争执行",
            doc: `
                + 并行执行所有子节点
                + 当有子节点返回 \`success\` 时，立即返回 \`success\` 状态，并中断其他子节点
                + 如果所有子节点返回 \`failure\` 则返回 \`failure\``,
        };
    }
}
