import { Node, NodeDef } from "../../node";
import { Process, Status } from "../../process";
import { TreeEnv } from "../../tree-env";

export class Sequence extends Process {
    override run(node: Node, env: TreeEnv): Status {
        const last = node.resume(env);
        let i = 0;

        if (typeof last === "number") {
            if (env.status === "success") {
                i = last + 1;
            } else if (env.status === "failure") {
                return "failure";
            } else {
                node.error(`unexpected status error: ${env.status}`);
            }
        }

        for (; i < node.children.length; i++) {
            const status = node.children[i].run(env);
            if (status === "failure") {
                return "failure";
            } else if (status === "running") {
                return node.yield(env, i);
            }
        }

        return "success";
    }

    override get descriptor(): NodeDef {
        return {
            name: "Sequence",
            type: "Composite",
            children: -1,
            status: ["&success", "|failure", "|running"],
            desc: "顺序执行",
            doc: `
                + 一直往下执行，只有当所有子节点都返回\`success\`, 才返回\`success\`
                + 若子节点返回\`failure\`，则直接返回\`failure\`状态
                + 其余情况返回\`running\`状态
            `,
        };
    }
}
