import { type Context } from "../../context";
import { Node, NodeDef, Status } from "../../node";
import { registerNode } from "../../register-node";
import { Tree } from "../../tree";

/**
 * Turns `error` of the child into `failure`, so the parent can try another branch.
 * The other statuses are returned as they are. An exception is not handled.
 */
@registerNode
export class ErrorToFailure extends Node {
    override onTick(tree: Tree<Context, unknown>): Status {
        const status = this.children[0].tick(tree);
        return status === "error" ? "failure" : status;
    }

    static override get descriptor(): NodeDef {
        return {
            name: "ErrorToFailure",
            type: "Decorator",
            group: ["Core"],
            children: 1,
            status: ["|success", "|failure", "|running"],
            desc: "错误转失败",
            doc: `
                + 只能有一个子节点，多个仅执行第一个
                + 当子节点返回 \`error\` 时，返回 \`failure\`，父节点可以接着执行其它分支
                + 其余情况返回子节点的执行状态
                + 不处理异常：子树里抛异常时，仍然中断整棵树
            `,
        };
    }
}
