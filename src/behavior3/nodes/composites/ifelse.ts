import { Node, NodeDef } from "../../node";
import { Process, Status } from "../../process";
import { TreeEnv } from "../../tree-env";

export class IfElse extends Process {
    private _ifelse(node: Node, env: TreeEnv, status: Exclude<Status, "running">) {
        const i = status === "success" ? 1 : 2;
        const childStatus = node.children[i].tick(env);
        if (childStatus === "running") {
            return node.yield(env, i);
        } else {
            return childStatus;
        }
    }

    override tick(node: Node, env: TreeEnv): Status {
        const i = node.resume(env) as number | undefined;
        let status: Status = env.status;
        if (i !== undefined) {
            if (status === "running") {
                node.error(`unexpected status error`);
            } else if (i === 0) {
                return this._ifelse(node, env, status);
            } else {
                return status;
            }
            return "failure";
        }

        status = node.children[0].tick(env);
        if (status === "running") {
            return node.yield(env, 0);
        } else {
            return this._ifelse(node, env, status);
        }
    }

    override get descriptor(): NodeDef {
        return {
            name: "IfElse",
            type: "Composite",
            children: 3,
            status: ["|success", "|failure", "|running"],
            desc: "条件执行",
            doc: `
                + 必须有三个子节点
                + 第一个子节点为条件节点
                + 第二个子节点为条件为 \`success\` 时执行的节点
                + 第三个子节点为条件为 \`failure\` 时执行的节点,
            `,
        };
    }
}
