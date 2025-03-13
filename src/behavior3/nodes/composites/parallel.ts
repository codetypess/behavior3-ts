import type { Context } from "../../context";
import { Node, NodeDef, Status } from "../../node";
import { Stack } from "../../stack";
import { Tree } from "../../tree";

const EMPTY_STACK: Stack = new Stack(null!);

/**
 * Parallel node executes all child nodes simultaneously.
 *
 * The execution flow is:
 * 1. Execute all child nodes in parallel
 * 2. If any child returns `running`, store its state and continue next tick
 * 3. Return `running` until all children complete
 * 4. When all children complete, return `success`
 *
 * Each child's execution state is tracked independently, allowing true parallel behavior.
 * The node only succeeds when all children have completed successfully.
 */
export class Parallel extends Node {
    override onTick(tree: Tree<Context, unknown>, status: Status): Status {
        const last: Stack[] = tree.resume(this) ?? [];
        const stack = tree.stack;
        const level = stack.length;
        const children = this.children;
        let count = 0;

        for (let i = 0; i < children.length; i++) {
            let childStack = last[i];
            let status: Status | undefined;
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
            } else {
                status = "success";
            }

            if (status === "running") {
                if (childStack === undefined) {
                    childStack = new Stack(tree);
                }
                stack.move(childStack, level, stack.length - level);
            } else {
                count++;
                childStack = EMPTY_STACK;
            }

            last[i] = childStack;
        }

        if (count === children.length) {
            return "success";
        } else {
            return tree.yield(this, last);
        }
    }

    static override get descriptor(): NodeDef {
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
