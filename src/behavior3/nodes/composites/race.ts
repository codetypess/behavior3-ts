import type { Context } from "../../context";
import { Node, NodeDef, Status } from "../../node";
import { Stack } from "../../stack";
import { Tree } from "../../tree";

const EMPTY_STACK: Stack = new Stack(null!);

/**
 * Race node executes all child nodes simultaneously until one succeeds or all fail.
 *
 * The execution flow is:
 * 1. Execute all child nodes in parallel
 * 2. If any child returns `success`, immediately return `success` and cancel other running children
 * 3. If any child returns `running`, store its state and continue next tick
 * 4. Return `failure` only when all children have failed
 *
 * Each child's execution state is tracked independently, allowing parallel execution.
 * The first child to succeed "wins the race" and causes the node to succeed.
 * The node only fails if all children fail.
 */
export class Race extends Node {
    override onTick(tree: Tree<Context, unknown>, status: Status): Status {
        const last: Stack[] = tree.resume(this) ?? [];
        const stack = tree.stack;
        const level = stack.length;
        const children = this.children;
        let count = 0;

        for (let i = 0; i < children.length; i++) {
            let childStack = last[i];
            status = "failure";
            if (childStack === undefined) {
                status = children[i].tick(tree);
            } else if (childStack.length > 0) {
                childStack.move(stack, 0, childStack.length);
                while (stack.length > level) {
                    status = stack.top()!.tick(tree);
                    if (status === "running") {
                        break;
                    }
                }
            }

            if (status === "running") {
                if (childStack === undefined) {
                    childStack = new Stack(tree);
                }
                stack.move(childStack, level, stack.length - level);
            } else if (status === "success") {
                last.forEach((v) => v !== EMPTY_STACK && v.clear());
                return "success";
            } else {
                count++;
                childStack = EMPTY_STACK;
            }

            last[i] = childStack;
        }

        if (count === children.length) {
            return "failure";
        } else {
            return tree.yield(this, last);
        }
    }

    static override get descriptor(): NodeDef {
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
