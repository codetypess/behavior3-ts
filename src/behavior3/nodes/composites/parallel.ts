import type { Context, DeepReadonly } from "../../context";
import { Node, NodeDef, Status } from "../../node";
import { Stack } from "../../stack";
import { Tree } from "../../tree";

const EMPTY_STACK: Stack = new Stack(null!);

export class Parallel extends Node {
    override onTick(tree: Tree<Context, unknown>): Status {
        const last: Stack[] = tree.resume(this) ?? [];
        const level = tree.stack.length;
        let count = 0;

        this.children.forEach((child, idx) => {
            let stack = last[idx];
            let status: Status | undefined;
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
            } else {
                status = "success";
            }

            if (status === "running") {
                if (stack === undefined) {
                    stack = new Stack(tree);
                }
                tree.stack.move(stack, level, tree.stack.length - level);
            } else {
                count++;
                stack = EMPTY_STACK;
            }

            last[idx] = stack;
        });

        if (count === this.children.length) {
            return "success";
        } else {
            return tree.yield(this, last);
        }
    }

    get descriptor(): DeepReadonly<NodeDef> {
        return {
            name: "Parallel",
            type: "Composite",
            status: ["success", "|running"],
            children: -1,
            desc: "并行执行",
            doc: `
                + 并行执行所有子节点
                + 当有子节点返回 \`running\` 时，返回 \`running\` 状态
                + 执行完所有子节点后，返回 \`success\``,
        };
    }
}
