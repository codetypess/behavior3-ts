import type { Context, DeepReadonly } from "../../context";
import { Node, NodeDef, Status } from "../../node";
import { Tree } from "../../tree";

export class Foreach extends Node {
    declare input: [unknown[]];
    declare output: [string];

    override onTick(tree: Tree<Context, unknown>): Status {
        const [arr] = this.input;
        const [varname] = this.cfg.output;
        let i: number | undefined = tree.resume(this);
        if (i !== undefined) {
            if (tree.lastNodeStatus === "running") {
                this.error(`unexpected status error`);
            } else if (tree.lastNodeStatus === "failure") {
                return "failure";
            }
            i++;
        } else {
            i = 0;
        }

        for (; i < arr.length; i++) {
            tree.blackboard.set(varname, arr[i]);
            const status = this.children[0].tick(tree);
            if (status === "running") {
                return tree.yield(this, i);
            } else if (status === "failure") {
                return "failure";
            }
        }

        return "success";
    }

    static override get descriptor(): DeepReadonly<NodeDef> {
        return {
            name: "ForEach",
            type: "Decorator",
            children: 1,
            status: ["success", "|running", "|failure"],
            desc: "遍历数组",
            input: ["数组"],
            output: ["变量"],
            doc: `
                + 只能有一个子节点，多个仅执行第一个
                + 遍历输入数组，将当前元素写入\`变量\`
                + 当子节点返回 \`failure\` 时，退出遍历并返回 \`failure\` 状态
                + 执行完所有子节点后，返回 \`success\``,
        };
    }
}
