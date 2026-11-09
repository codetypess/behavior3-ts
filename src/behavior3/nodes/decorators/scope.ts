import { Blackboard } from "../../blackboard";
import { type Context } from "../../context";
import { Node, NodeDef, SKIP, Status } from "../../node";
import { registerNode } from "../../register-node";
import { Tree } from "../../tree";

/**
 * Runs the child in an isolated scope: the child reads the outer variables, its writes stay in
 * the scope, and the variables listed in the output are exported to the outer scope on success.
 */
@registerNode
export class Scope extends Node {
    override get __isScope(): boolean {
        return true;
    }

    override onTick(
        tree: Tree<Context, unknown>,
        _input: readonly unknown[],
        output: unknown[],
    ): Status {
        const scope = tree.getState<Blackboard>(this) ?? tree.blackboard.fork();
        const outer = tree.__swapScope(scope);
        let status: Status;
        try {
            status = this.children[0].tick(tree);
        } finally {
            tree.__swapScope(outer);
        }

        if (status === "running") {
            tree.setState(this, scope);
        } else {
            // the framework writes the output on failure too, SKIP leaves the outer variables
            const keys = this.cfg.output;
            const success = status === "success";
            for (let i = 0; i < keys.length; i++) {
                const key = keys[i];
                output[i] = success && scope.hasOwn(key) ? scope.get(key) : SKIP;
            }
        }
        return status;
    }

    static override get descriptor(): NodeDef {
        return {
            name: "Scope",
            type: "Decorator",
            group: ["Core"],
            children: 1,
            status: ["|success", "|failure", "|running"],
            desc: "在独立作用域中执行子节点",
            output: ["导出变量..."],
            doc: `
                + 子节点在独立的作用域中执行，可以读取外层变量
                + 子节点的写入只影响作用域内，写外层已有的变量也只是在作用域内生成同名变量，外层不变
                + 要修改外层变量，把它列在 \`导出变量\` 中，成功时写回外层，失败、\`error\` 和被中断时不写回
                + 作为条件树的根节点时，条件为 true 才导出
            `,
        };
    }
}
