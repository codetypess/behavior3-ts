import { type Context } from "../../context";
import { Node, NodeData, NodeDef, Status } from "../../node";
import { registerNode } from "../../register-node";
import { Tree } from "../../tree";

/**
 * Switch node that executes cases in order until one matches.
 *
 * Each child must be a Case node with exactly 2 children:
 * 1. The condition node that determines if this case matches
 * 2. The action node to execute if condition returns `success`
 *
 * The execution flow is:
 * 1. Execute first child (condition) of each case in order
 * 2. If condition returns `success`, execute second child (action)
 * 3. Return the status of the action node
 * 4. If no case matches, return `failure`
 *
 * Similar to a switch statement, cases are evaluated in order
 * until a matching condition is found. Only the action of the
 * first matching case is executed.
 */
@registerNode
export class Switch extends Node {
    constructor(context: Context, cfg: NodeData) {
        super(context, cfg);

        this.children.forEach((v) => {
            if (v.name !== "Case") {
                this.throw(`only allow Case node`);
            }
        });
    }

    override onTick(tree: Tree<Context, unknown>): Status {
        const children = this.children;
        // step: 2 * i for the condition of the i-th case, 2 * i + 1 for its action
        let step = tree.getState<number>(this) ?? 0;

        for (let i = step >>> 1; i < children.length; i++) {
            const [first, second] = children[i].children;
            if (step % 2 === 0) {
                const status = first.tick(tree);
                if (status === "running") {
                    tree.setState(this, step);
                    return "running";
                } else if (status === "error") {
                    return "error";
                } else if (status !== "success") {
                    step = i * 2 + 2;
                    continue;
                }
                step = i * 2 + 1;
            }
            const status = second.tick(tree);
            if (status === "running") {
                tree.setState(this, step);
            }
            return status;
        }

        return "failure";
    }

    override onAbort(tree: Tree<Context, unknown>): void {
        // the children of Case are ticked by Switch directly
        const step = tree.getState<number>(this);
        if (step !== undefined) {
            this.children[step >>> 1].children[step % 2].abort(tree);
        }
    }

    static override get descriptor(): NodeDef {
        return {
            name: "Switch",
            type: "Composite",
            group: ["Core"],
            children: -1,
            status: ["|success", "|failure", "|running"],
            desc: "执行第一个条件满足的 Case 分支",
            doc: `
                + 子节点只能是 \`Case\`
                + 按顺序执行每个 \`Case\` 的条件（第一个子节点），第一个返回 \`success\` 的 \`Case\`，执行它的分支（第二个子节点），返回分支的状态
                + 没有条件返回 \`success\` 时，返回 \`failure\`
                + 条件返回 \`error\` 时，立即返回 \`error\`
            `,
        };
    }
}

@registerNode
export class Case extends Node {
    constructor(context: Context, cfg: NodeData) {
        super(context, cfg);

        // Case is a virtual node grouping the condition and the action, it is never ticked
        if (this.conditions.length > 0) {
            this.warn(`conditions are ignored: Case is never ticked`);
        }
    }

    override onTick(tree: Tree<Context, unknown>): Status {
        throw new Error("tick children by Switch");
    }

    static override get descriptor(): NodeDef {
        return {
            name: "Case",
            type: "Composite",
            group: ["Core"],
            children: 2,
            status: ["&success", "|failure", "|running"],
            desc: "Switch 的一个分支",
            doc: `
                + 只能放在 \`Switch\` 下，必须有两个子节点：条件、分支
                + 只用来把条件和分支组织在一起，本身不会执行，由 \`Switch\` 直接执行它的子节点
                + 此节点上配置的条件（conditions）不会生效
            `,
        };
    }
}
