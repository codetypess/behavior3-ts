import { Node } from "../../node";
import { Process, Status } from "../../process";
import { TreeEnv } from "../../tree-env";

interface NodeArgs {
    readonly count: number;
}

export class Repeat extends Process {
    constructor() {
        super({
            name: "Repeat",
            type: "Decorator",
            children: 1,
            status: ["success", "|running", "|failure"],
            desc: "循环执行",
            input: ["循环次数?"],
            args: [
                {
                    name: "count",
                    type: "int?",
                    desc: "循环次数",
                    oneof: "循环次数",
                },
            ],
            doc: `
                + 只能有一个子节点，多个仅执行第一个
                + 当子节点返回 \`failure\` 时，退出遍历并返回 \`failure\` 状态
                + 执行完所有子节点后，返回 \`success\`
            `,
        });
    }

    override tick(node: Node, env: TreeEnv): Status {
        const args = node.args as unknown as NodeArgs;
        const count = this._checkOneof(node, env, 0, args.count, Number.MAX_SAFE_INTEGER);

        let i = node.resume(env) as number | undefined;

        if (i !== undefined) {
            if (env.status === "running") {
                node.error(`unexpected status error`);
            } else if (env.status === "failure") {
                return "failure";
            }
            i++;
        } else {
            i = 0;
        }

        for (; i < count; i++) {
            const status = node.children[0].tick(env);
            if (status === "running") {
                return node.yield(env, i);
            } else if (status === "failure") {
                return "failure";
            }
        }
        return "success";
    }
}
