import type { Context } from "../../context";
import { Node, NodeDef, Status } from "../../node";
import { Tree } from "../../tree";

export class Invert extends Node {
    override onTick(tree: Tree<Context, unknown>, status: Status): Status {
        const isYield: boolean | undefined = tree.resume(this);
        if (typeof isYield === "boolean") {
            if (status === "running") {
                this.throw(`unexpected status error`);
            }
            return this._invert(status);
        }
        status = this.children[0].tick(tree);
        if (status === "running") {
            return tree.yield(this);
        }
        return this._invert(status);
    }

    private _invert(status: Exclude<Status, "running">): Status {
        if (status === "error") {
            return "error";
        } else if (status === "failure") {
            return "success";
        } else {
            return "failure";
        }
    }

    static override get descriptor(): NodeDef {
        return {
            name: "Invert",
            type: "Decorator",
            children: 1,
            status: ["!success", "!failure", "|running"],
            desc: "反转子节点运行结果",
            doc: `
                + 只能有一个子节点，多个仅执行第一个
                + 当子节点返回 \`success\` 时返回 \`failure\`
                + 当子节点返回 \`failure\` 时返回 \`success\`
            `,
        };
    }
}
