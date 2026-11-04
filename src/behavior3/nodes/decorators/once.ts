import { Blackboard } from "../../blackboard";
import { type Context } from "../../context";
import { Node, NodeData, NodeDef, Status } from "../../node";
import { registerNode } from "../../register-node";
import { Tree } from "../../tree";

@registerNode
export class Once extends Node {
    private _onceKey!: string;

    constructor(context: Context, cfg: NodeData) {
        super(context, cfg);

        this._onceKey = Blackboard.makePrivateVar(this, "ONCE");
    }

    override onTick(tree: Tree<Context, unknown>): Status {
        const onceKey = this._onceKey;
        if (tree.blackboard.get(onceKey) === true) {
            return "failure";
        }

        const status = this.children[0].tick(tree);
        if (status === "running" || status === "error") {
            // not used up by an error
            return status;
        }
        tree.blackboard.set(onceKey, true);
        return "success";
    }

    static override get descriptor(): NodeDef {
        return {
            name: "Once",
            type: "Decorator",
            group: ["Core"],
            children: 1,
            status: ["success", "failure", "|running"],
            desc: "子节点只执行一次",
            doc: `
                + 只能有一个子节点，多个仅执行第一个
                + 子节点第一次执行结束时（不论 \`success\` 还是 \`failure\`）返回 \`success\`，之后不再执行子节点，总是返回 \`failure\`
                + 子节点返回 \`running\` 时返回 \`running\`
                + 子节点返回 \`error\` 时返回 \`error\`，不算执行过，下次还会执行
                + 执行记录保存在行为树实例上，清理行为树后重置`,
        };
    }
}
