import { Tree } from "../../src/behavior3";
import { Node, NodeDef, Status } from "../../src/behavior3/node";
import { Role, RoleContext } from "../role";

export class IsStatus extends Node {
    declare args: {
        readonly status: Status;
    };

    override onTick(tree: Tree<RoleContext, Role>): Status {
        const owner = tree.owner;
        const args = this.args;
        const level = tree.stack.length;
        const status = this.children[0].tick(tree);
        if (status === "running") {
            tree.stack.popTo(level);
        }
        return status === args.status ? "success" : "failure";
    }

    static override get descriptor(): Readonly<NodeDef> {
        return {
            name: "IsStatus",
            type: "Condition",
            children: 1,
            status: ["success", "failure"],
            desc: "检查子节点状态",
            args: [
                {
                    name: "status",
                    type: "string",
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
