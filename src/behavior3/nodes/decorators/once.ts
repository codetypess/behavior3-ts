import { Node, NodeDef, NodeVars as NodeVarsBase } from "../../node";
import { Process, Status } from "../../process";
import { TreeEnv } from "../../tree-env";

interface NodeVars extends NodeVarsBase {
    onceKey: string;
}

export class Once extends Process {
    override init(node: Node): void {
        const vars = node.vars as NodeVars;
        vars.onceKey = TreeEnv.makePrivateVar(node, "ONCE");

        this._checkOneChild(node);
    }

    override run(node: Node, env: TreeEnv): Status {
        const onceKey = (node.vars as NodeVars).onceKey;
        if (env.get(onceKey) === true) {
            return "failure";
        }

        const isYield = node.resume(env);
        if (typeof isYield === "boolean") {
            if (env.status === "running") {
                node.error(`unexpected status error`);
            }
            env.set(onceKey, true);
            return "success";
        }

        const status = node.children[0].run(env);
        if (status === "running") {
            return node.yield(env);
        }
        env.set(onceKey, true);
        return "success";
    }

    override get descriptor(): NodeDef {
        return {
            name: "Once",
            type: "Decorator",
            status: ["success", "failure", "?running"],
            desc: "只执行一次",
            doc: `
                + 只能有一个子节点，多个仅执行第一个
                + 第一次执行完全部子节点时返回\`成功\`，之后永远返回\`失败\``,
        };
    }
}
