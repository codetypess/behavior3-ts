import { ObjectType } from "../../context";
import { Node } from "../../node";
import { Process, Status } from "../../process";
import { TreeEnv } from "../../tree-env";

export class Switch extends Process {
    constructor() {
        super({
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
        });
    }

    override init(node: Node): Readonly<ObjectType> | void {
        node.children.forEach((v) => {
            if (v.name !== "Case") {
                node.error(`only allow Case node`);
            }
        });
    }

    override tick(node: Node, env: TreeEnv): Status {
        let step = node.resume(env) as number | undefined;
        let status = env.status;
        if (typeof step === "number") {
            if (status === "running") {
                node.error(`unexpected status error`);
            }
            if (step % 2 === 0) {
                if (status === "success") {
                    step += 1; // do second node in case
                } else {
                    step += 2; // next case
                }
            } else {
                return status;
            }
        } else {
            step = 0;
        }

        for (let i = step >>> 1; i < node.children.length; i++) {
            const [first, second] = node.children[i].children;
            if (step % 2 === 0) {
                status = first.tick(env);
                if (status === "running") {
                    return node.yield(env, step);
                } else if (status === "success") {
                    step = i * 2 + 1;
                } else {
                    step = i * 2 + 2;
                }
            }
            if (step % 2 === 1) {
                status = second.tick(env);
                if (status === "running") {
                    return node.yield(env, step);
                }
                return status;
            }
        }

        return "failure";
    }
}

export class Case extends Process {
    constructor() {
        super({
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
        });
    }

    override tick(node: Node, env: TreeEnv): Status {
        throw new Error("Tick children by Switch");
    }
}
