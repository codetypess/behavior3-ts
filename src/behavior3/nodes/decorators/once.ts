import { Node, NodeDef, NodeVars as NodeVarsBase } from "../../node";
import { Process, Status } from "../../process";
import { TreeEnv } from "../../tree-env";

interface NodeVars extends NodeVarsBase {
    once: string;
}

export class Once extends Process {
    override init(node: Node): void {
        const vars = node.vars as NodeVars;
        vars.once = TreeEnv.makePrivateVar(node, "once");
    }

    override run(node: Node, env: TreeEnv): Status {
        const once = (node.vars as NodeVars).once;
        if (env.get(once) === true) {
            return "failure";
        }

        const last = node.resume(env);
        let i = 0;

        if (typeof last === "number") {
            if (env.status === "running") {
                node.error(`unexpected status error`);
            }
            i = last + 1;
        }

        for (; i < node.children.length; i++) {
            const status = node.children[i].run(env);
            if (status === "running") {
                return node.yield(env, i);
            }
        }

        env.set(once, true);

        return "success";
    }

    override get descriptor(): NodeDef {
        return {
            name: "Once",
            type: "Decorator",
            desc: "只执行一次",
            doc: `
                + 可以接多个子节点，子节点默认全部执行
                + 第一次执行完全部子节点时返回「成功」，之后永远返回「失败」`,
        };
    }
}
