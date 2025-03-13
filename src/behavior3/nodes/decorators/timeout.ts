import type { Context } from "../../context";
import { Node, NodeDef, Status } from "../../node";
import { Stack } from "../../stack";
import { Tree } from "../../tree";

interface NodeYield {
    stack: Stack;
    expired: number;
}

export class Timeout extends Node {
    declare args: { readonly time?: number };

    override onTick(tree: Tree<Context, unknown>, status: Status): Status {
        const { stack, context } = tree;
        const level = stack.length;
        let last: NodeYield | undefined = tree.resume(this);
        status = "failure";
        if (last === undefined) {
            status = this.children[0].tick(tree);
        } else if (context.time >= last.expired) {
            last.stack.clear();
            return "failure";
        } else {
            last.stack.move(stack, 0, last.stack.length);
            while (stack.length > level) {
                const child = stack.top()!;
                status = child.tick(tree);
                if (status === "running") {
                    break;
                }
            }
        }

        if (status === "running") {
            if (last === undefined) {
                const time = this._checkOneof(0, this.args.time, 0);
                last = {
                    stack: new Stack(tree),
                    expired: context.time + time,
                };
            }
            stack.move(last.stack, level, stack.length - level);
            return tree.yield(this, last);
        } else {
            return status;
        }
    }

    static override get descriptor(): NodeDef {
        return {
            name: "Timeout",
            type: "Decorator",
            children: 1,
            status: ["|success", "|running", "failure"],
            desc: "超时",
            input: ["超时时间?"],
            args: [
                {
                    name: "time",
                    type: "float?",
                    desc: "超时时间",
                    oneof: "超时时间",
                },
            ],
            doc: `
                + 只能有一个子节点，多个仅执行第一个
                + 当子节点执行超时或返回 \`failure\` 时，返回 \`failure\`
                + 其余情况返回子节点的执行状态
            `,
        };
    }
}
