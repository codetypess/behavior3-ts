import type { Context, DeepReadonly } from "../../context";
import { Node, NodeDef, Status } from "../../node";
import { Tree } from "../../tree";

export class AlwaysFailure extends Node {
    override onTick(tree: Tree<Context, unknown>): Status {
        const isYield: boolean | undefined = tree.resume(this);
        if (typeof isYield === "boolean") {
            if (tree.status === "running") {
                this.error(`unexpected status error`);
            }
            return "failure";
        }
        const status = this.children[0].tick(tree);
        if (status === "running") {
            return tree.yield(this);
        }
        return "failure";
    }

    get descriptor(): DeepReadonly<NodeDef> {
        return {
            name: "AlwaysFailure",
            type: "Decorator",
            children: 1,
            status: ["failure", "|running"],
            desc: "始终返回失败",
            doc: `
                + 只能有一个子节点，多个仅执行第一个
                + 不管子节点是否成功都返回 \`failure\`
            `,
        };
    }
}
