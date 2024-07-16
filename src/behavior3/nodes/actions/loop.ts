import { Node, NodeDef } from "../../node";
import { Process, Status } from "../../process";
import { TreeEnv } from "../../tree-env";

interface NodeArgs {
    readonly count: number;
}

type NodeInput = [number | undefined];

export class Loop extends Process {
    override init(node: Node): void {
        this._checkOneChild(node);
    }

    override run(node: Node, env: TreeEnv): Status {
        let [count] = env.input as NodeInput;
        const args = node.args as unknown as NodeArgs;
        count = count ?? args.count;

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
            const status = node.children[0].run(env);
            if (status === "running") {
                return node.yield(env, i);
            } else if (status === "failure") {
                return "failure";
            }
        }
        return "success";
    }

    override get descriptor(): NodeDef {
        return {
            name: "Loop",
            type: "Action",
            status: ["success", "running", "failure"],
            desc: "循环执行",
            input: ["循环次数?"],
            args: [{ name: "count", type: "int", desc: "循环次数" }],
            doc: `
                + 只能有一个子节点，多个仅执行第一个
                + 当子节点返回\`失败\`时，退出遍历并返回\`失败\`状态
                + 执行完所有子节点后，返回\`成功\`
            `,
        };
    }
}
