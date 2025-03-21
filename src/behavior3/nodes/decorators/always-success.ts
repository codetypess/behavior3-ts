import type { Context } from "../../context";
import { Node, NodeDef, Status } from "../../node";
import { Tree } from "../../tree";

export class AlwaysSuccess extends Node {
    override onTick(tree: Tree<Context, unknown>, status: Status): Status {
        const isYield: boolean | undefined = tree.resume(this);
        if (typeof isYield === "boolean") {
            if (status === "running") {
                this.throw(`unexpected status error`);
            }
            return "success";
        }
        status = this.children[0].tick(tree);
        if (status === "running") {
            return tree.yield(this);
        }
        return "success";
    }

    static override get descriptor(): NodeDef {
        return {
            name: "AlwaysSuccess",
            type: "Decorator",
            children: 1,
            status: ["success", "|running"],
            desc: "始终返回成功",
            doc: `
                + 只能有一个子节点，多个仅执行第一个
                + 当子节点返回 \`running\` 时，返回 \`running\`
                + 其它情况，不管子节点是否成功都返回 \`success\`
            `,
        };
    }
}
