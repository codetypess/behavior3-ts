import { type Context } from "../../context";
import { Node, NodeDef, Status } from "../../node";
import { registerNode } from "../../register-node";
import { Tree } from "../../tree";

@registerNode
export class Filter extends Node {
    declare input: [unknown[]];

    override onTick(tree: Tree<Context, unknown>): Status {
        const [arr] = this.input;
        if (!(arr instanceof Array)) {
            this.warn(`invalid array: ${arr}`);
            return "error";
        }

        if (arr.length === 0) {
            return "failure";
        }

        const last = tree.getState<[number, unknown[]]>(this);
        let i = last ? last[0] : 0;
        const newArr = last ? last[1] : [];

        const filter = this.children[0];

        for (; i < arr.length; i++) {
            tree.blackboard.set(this.cfg.output[0], arr[i]);
            const status = filter.tick(tree);
            if (status === "running") {
                tree.setState(this, [i, newArr]);
                return "running";
            } else if (status === "error") {
                return "error";
            } else if (status === "success") {
                newArr.push(arr[i]);
            }
        }

        this.output.push(undefined, newArr);

        return newArr.length === 0 ? "failure" : "success";
    }

    static override get descriptor(): NodeDef {
        return {
            name: "Filter",
            type: "Decorator",
            group: ["Core"],
            children: 1,
            status: ["success", "failure", "|running"],
            desc: "返回满足条件的元素",
            input: ["输入数组"],
            output: ["变量", "新数组"],
            doc: `
                + 只能有一个子节点，多个仅执行第一个
                + 遍历输入数组，将当前元素写入\`变量\`，满足条件的元素放入新数组
                + 只有当新数组不为空时，才返回 \`success\`
                + 输入不是数组，或者子节点返回 \`error\` 时，返回 \`error\`
            `,
        };
    }
}
