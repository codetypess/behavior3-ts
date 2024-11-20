import { Node, NodeDef } from "../../node";
import { Process, Status } from "../../process";
import { TreeEnv } from "../../tree-env";

interface NodeConsts {
    readonly onceKey: string;
}

export class Once extends Process {
    override init(node: Node): Readonly<NodeConsts> {
        return {
            onceKey: TreeEnv.makePrivateVar(node, "ONCE"),
        };
    }

    override tick(node: Node, env: TreeEnv): Status {
        const onceKey = (node.consts as Readonly<NodeConsts>).onceKey;
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

        const status = node.children[0].tick(env);
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
            children: 1,
            status: ["success", "failure", "|running"],
            desc: "只执行一次",
            doc: `
                + 只能有一个子节点，多个仅执行第一个
                + 第一次执行完全部子节点时返回 \`success\`，之后永远返回 \`failure\``,
        };
    }
}
