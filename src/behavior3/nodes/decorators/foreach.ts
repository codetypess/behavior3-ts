import { type Context } from "../../context";
import { Node, NodeDef, Status } from "../../node";
import { registerNode } from "../../register-node";
import { Tree } from "../../tree";

@registerNode
export class Foreach extends Node {
    declare input: [unknown[]];
    declare output: [unknown, number?];

    override onTick(tree: Tree<Context, unknown>): Status {
        const [arr] = this.input;
        if (!Array.isArray(arr)) {
            this.warn(`invalid array: ${arr}`);
            return "error";
        }

        const [varname, idx] = this.cfg.output;
        let i = tree.getState<number>(this) ?? 0;

        for (; i < arr.length; i++) {
            tree.blackboard.set(varname, arr[i]);
            if (idx) {
                tree.blackboard.set(idx, i);
            }
            const status = this.children[0].tick(tree);
            if (status === "running") {
                tree.setState(this, i);
                return "running";
            } else if (status === "failure" || status === "error") {
                return status;
            }
        }

        return "success";
    }

    static override get descriptor(): NodeDef {
        return {
            name: "ForEach",
            type: "Decorator",
            group: ["Core"],
            children: 1,
            status: ["success", "|running", "|failure"],
            desc: "遍历数组",
            input: ["数组"],
            output: ["变量", "索引?"],
            doc: `
                + 只能有一个子节点，多个仅执行第一个
                + 遍历输入数组，将当前元素写入\`变量\`
                + 当子节点返回 \`failure\` 或 \`error\` 时，退出遍历并返回该状态
                + 输入不是数组时，返回 \`error\`
                + 执行完所有子节点后，返回 \`success\``,
        };
    }
}
