import { Context } from "../../context";
import { Node, NodeDef } from "../../node";
import { Process, Status } from "../../process";
import { TreeEnv } from "../../tree-env";

interface NodeArgs {
    readonly status: Status;
}

export class IsStatus extends Process {
    override init(node: Node): void {
        if (node.children.length === 0) {
            node.error(`${node.tree.name}#${node.id}: at least one children`);
        }
    }

    override run(node: Node, env: TreeEnv<Context>): Status {
        const args = node.args as unknown as NodeArgs;
        const level = env.stack.length;
        const status = node.children[0].run(env);
        if (status === "running") {
            while (env.stack.length > level) {
                const child = env.stack.pop()!;
                env.set(child.vars.yieldKey, undefined);
            }
        }
        return status === args.status ? "success" : "failure";
    }

    override get descriptor(): NodeDef {
        return {
            name: "IsStatus",
            type: "Condition",
            desc: "检查子节点状态",
            args: [
                {
                    name: "status",
                    type: "enum",
                    desc: "检查子节点的执行状态",
                    options: [
                        { name: "成功", value: "success" },
                        { name: "失败", value: "failure" },
                        { name: "运行中", value: "running" },
                    ],
                },
            ],
            doc: `
                + 只能有一个子节点，多个仅执行第一个
                + 只有当子节点的执行状态与指定状态相同时才返回「成功」，其余返回失败
                + 若子节点返回「运行中」状态，将中断子节点并清理子节点的执行栈`,
        };
    }
}
