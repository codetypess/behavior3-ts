import { Node, NodeDef } from "../../node";
import { Process, Status } from "../../process";
import { TreeEnv } from "../../tree-env";

export class RepeatUntilSuccess extends Process {
    override check(node: Node) {
        if (node.children.length == 0) {
            node.error(`at least one children`);
        }
    }

    override run(node: Node, env: TreeEnv): Status {
        const isYield = node.resume(env) !== undefined;
        if (isYield) {
            if (env.status === "running") {
                node.error(`unexpected status error`);
            }
            if (env.status === "success") {
                return "success";
            }
        }
        const status = node.children[0].run(env);
        if (status === "success") {
            return "success";
        } else {
            return "running";
        }
    }

    override get descriptor(): NodeDef {
        return {
            name: "RepeatUntilSuccess",
            type: "Decorator",
            desc: "一直尝试直到子节点返回成功",
            doc: `
                + 只能有一个子节点，多个仅执行第一个
                + 只有当子节点返回成功时，才返回成功，其它情况返回运行中状态`,
        };
    }
}
