import { type Context } from "../../context";
import { Node, NodeDef, Status } from "../../node";
import { registerNode } from "../../register-node";
import { Tree } from "../../tree";

@registerNode
export class Filter extends Node {

    override onTick(
        tree: Tree<Context, unknown>,
        input: readonly [unknown[]],
        output: unknown[],
    ): Status {
        const [arr] = input;
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

        output.push(undefined, newArr);

        return newArr.length === 0 ? "failure" : "success";
    }

    static override get descriptor(): NodeDef {
        return {
            name: "Filter",
            type: "Decorator",
            group: ["Core"],
            children: 1,
            status: ["success", "failure", "|running"],
            desc: "筛选出子节点返回成功的元素",
            input: ["数组"],
            output: ["当前元素", "新数组"],
            doc: `
                + 只能有一个子节点，多个仅执行第一个
                + 遍历 \`数组\`，把每个元素写入 \`当前元素\` 后执行子节点，子节点返回 \`success\` 的元素放入 \`新数组\`
                + \`新数组\` 不为空时返回 \`success\`；为空，或者输入数组为空时，返回 \`failure\`
                + 输入不是数组，或者子节点返回 \`error\` 时，返回 \`error\`
            `,
        };
    }
}
