import { Node, NodeDef } from "../../node";
import { Process, Status } from "../../process";
import { TreeEnv } from "../../tree-env";

export class AlwaysSuccess extends Process {
    override init(node: Node): void {
        if (node.children.length == 0) {
            node.error(`${node.tree.name}#${node.id}: at least one children`);
        }
    }

    override run(node: Node, env: TreeEnv): Status {
        const isYield = node.resume(env);
        if (typeof isYield === "boolean") {
            if (env.status === "running") {
                return "running";
            }
            return "success";
        }
        const status = node.children[0].run(env);
        if (status === "running") {
            return node.yield(env);
        }
        return "success";
    }

    override get descriptor(): NodeDef {
        return {
            name: "AlwaysSuccess",
            type: "Decorator",
            desc: "始终返回成功",
            doc: `
                + 只能有一个子节点，多个仅执行第一个
                + 不管子节点是否成功都返回「成功」`,
        };
    }
}
