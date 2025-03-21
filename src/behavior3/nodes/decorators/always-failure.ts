import type { Context } from "../../context";
import { Node, NodeDef, Status } from "../../node";
import { Tree } from "../../tree";

export class AlwaysFailure extends Node {
    override onTick(tree: Tree<Context, unknown>, status: Status): Status {
        const isYield: boolean | undefined = tree.resume(this);
        if (typeof isYield === "boolean") {
            if (status === "running") {
                this.throw(`unexpected status error`);
            }
            return "failure";
        }
        status = this.children[0].tick(tree);
        if (status === "running") {
            return tree.yield(this);
        }
        return "failure";
    }

    static override get descriptor(): NodeDef {
        return {
            name: "AlwaysFailure",
            type: "Decorator",
            children: 1,
            status: ["failure", "|running"],
            desc: "始终返回失败",
            doc: `
                + 只能有一个子节点，多个仅执行第一个
                + 当子节点返回 \`running\` 时，返回 \`running\`
                + 其它情况，不管子节点是否成功都返回 \`failure\`
            `,
        };
    }
}
