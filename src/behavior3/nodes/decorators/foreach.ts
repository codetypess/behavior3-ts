import { type Context } from "../../context";
import { Node, NodeDef, Status } from "../../node";
import { registerNode } from "../../register-node";
import { Tree } from "../../tree";

@registerNode
export class Foreach extends Node {

    override onTick(tree: Tree<Context, unknown>, input: readonly [unknown[]]): Status {
        const [arr] = input;
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
            desc: "遍历数组，对每个元素执行子节点",
            input: ["数组"],
            output: ["当前元素", "索引?"],
            doc: `
                + 只能有一个子节点，多个仅执行第一个
                + 遍历 \`数组\`，把每个元素写入 \`当前元素\`、下标写入 \`索引\` 后执行子节点
                + 子节点返回 \`failure\` 或 \`error\` 时，退出遍历并返回该状态
                + 所有元素都执行成功后（包括空数组），返回 \`success\`
                + 输入不是数组时，返回 \`error\``,
        };
    }
}
