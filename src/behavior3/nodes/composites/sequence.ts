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
                node.error(`unexpected status error`);
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
            desc: "顺序执行",
            doc: `
                + 一直往下执行，只有当所有子节点都返回成功, 才返回成功
                + 子节点是与（AND）的关系`,
        };
    }
}
