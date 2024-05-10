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
            desc: "选择执行",
            doc: `
                + 一直往下执行，有子节点返回「成功」则返回「成功」
                + 若全部节点返回「失败」则返回「失败」
                + 子节点是或 (OR) 的关系`,
        };
    }
}
