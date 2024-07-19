import { Node, NodeDef } from "../../node";
import { Process, Status } from "../../process";
import { TreeEnv } from "../../tree-env";

export class Selector extends Process {
    override run(node: Node, env: TreeEnv): Status {
        const last = node.resume(env);
        let i = 0;

        if (typeof last === "number") {
            if (env.status === "failure") {
                i = last + 1;
            } else if (env.status === "success") {
                return "success";
            } else {
                node.error(`unexpected status error`);
            }
        }

        for (; i < node.children.length; i++) {
            const status = node.children[i].run(env);
            if (status === "success") {
                return "success";
            } else if (status === "running") {
                return node.yield(env, i);
            }
        }

        return "failure";
    }

    override get descriptor(): NodeDef {
        return {
            name: "Selector",
            type: "Composite",
            children: -1,
            desc: "选择执行",
            status: ["|success", "&failure", "|running"],
            doc: `
                + 一直往下执行，直到有子节点返回\`success\`则返回\`success\`
                + 若全部节点返回\`failure\`则返回\`failure\``,
        };
    }
}
