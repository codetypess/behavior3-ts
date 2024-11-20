import { Context } from "../../src/behavior3/context";
import { Node, NodeDef } from "../../src/behavior3/node";
import { Process, Status } from "../../src/behavior3/process";
import { TreeEnv } from "../../src/behavior3/tree-env";

interface NodeArgs {
    readonly status: Status;
}

export class IsStatus extends Process {
    override tick(node: Node, env: TreeEnv<Context>): Status {
        const args = node.args as unknown as NodeArgs;
        const level = env.stack.length;
        const status = node.children[0].tick(env);
        if (status === "running") {
            env.stack.popTo(level);
        }
        return status === args.status ? "success" : "failure";
    }

    override get descriptor(): NodeDef {
        return {
            name: "IsStatus",
            type: "Condition",
            children: 1,
            status: ["success", "failure"],
            desc: "检查子节点状态",
            args: [
                {
                    name: "status",
                    type: "enum",
                    desc: "执行状态",
                    options: [
                        { name: "成功", value: "success" },
                        { name: "失败", value: "failure" },
                        { name: "运行中", value: "running" },
                    ],
                },
            ],
            doc: `
                + 只能有一个子节点，多个仅执行第一个
                + 只有当子节点的执行状态与指定状态相同时才返回 \`success\`，其余返回失败
                + 若子节点返回 \`running\` 状态，将中断子节点并清理子节点的执行栈`,
        };
    }
}
