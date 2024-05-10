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

        for (let i = 0; i < node.children.length; i++) {
            const status = node.children[i].run(env);
            if (status === "running") {
                node.error("this child should not return running status");
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
                + 被打断后该节点后的子节点依旧不会执行
                + 该节点执行后永远返回「成功」`,
        };
    }
}
