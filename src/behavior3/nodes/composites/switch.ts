import type { Context } from "../../context";
import { Node, NodeData, NodeDef, Status } from "../../node";
import { Tree } from "../../tree";

export class Switch extends Node {
    constructor(context: Context, cfg: NodeData) {
        super(context, cfg);

        this.children.forEach((v) => {
            if (v.name !== "Case") {
                this.error(`only allow Case node`);
            }
        });
    }

    override onTick(tree: Tree<Context, unknown>): Status {
        let step: number | undefined = tree.resume(this);
        const lastNodeStatus = tree.lastNodeStatus;
        const children = this.children;

        if (typeof step === "number") {
            if (lastNodeStatus === "running") {
                this.error(`unexpected status error`);
            }
            if (step % 2 === 0) {
                if (lastNodeStatus === "success") {
                    step += 1; // do second node in case
                } else {
                    step += 2; // next case
                }
            } else {
                return lastNodeStatus;
            }
        } else {
            step = 0;
        }

        for (let i = step >>> 1; i < children.length; i++) {
            const [first, second] = children[i].children;
            if (step % 2 === 0) {
                const status = first.tick(tree);
                if (status === "running") {
                    return tree.yield(this, step);
                } else if (status === "success") {
                    step = i * 2 + 1;
                } else {
                    step = i * 2 + 2;
                }
            }
            if (step % 2 === 1) {
                const status = second.tick(tree);
                if (status === "running") {
                    return tree.yield(this, step);
                }
                return status;
            }
        }

        return "failure";
    }

    static override get descriptor(): NodeDef {
        return {
            name: "Switch",
            type: "Composite",
            children: -1,
            status: ["|success", "|failure", "|running"],
            desc: "分支执行",
            doc: `
                + 按顺序测试 \`Case\` 节点的判断条件（第一个子节点）
                + 若测试返回 \`success\` 则执行 \`Case\` 第二个子节点，并返回子节点的执行状态
                + 若没有判断为 \`success\` 的 \`Case\` 节点，则返回 \`failure\`
            `,
        };
    }
}

export class Case extends Node {
    override onTick(tree: Tree<Context, unknown>): Status {
        throw new Error("tick children by Switch");
    }

    static override get descriptor(): NodeDef {
        return {
            name: "Case",
            type: "Composite",
            children: 2,
            status: ["&success", "|failure", "|running"],
            desc: "分支选择",
            doc: `
                + 必须有两个子节点
                + 第一个子节点为判断条件
                + 第二个子节点为判断为 \`success\` 时执行的节点
                + 此节点不会真正意义的执行，而是交由 \`Switch\` 节点来执行
            `,
        };
    }
}
