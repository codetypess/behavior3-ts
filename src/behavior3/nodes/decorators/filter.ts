import type { Context } from "../../context";
import { Node, NodeDef, Status } from "../../node";
import { Tree } from "../../tree";

export class Filter extends Node {
    declare input: [unknown[]];

    override onTick(tree: Tree<Context, unknown>, status: Status): Status {
        const [arr] = this.input;
        if (!(arr instanceof Array)) {
            return "error";
        }

        if (arr.length === 0) {
            return "failure";
        }

        let last: [number, unknown[]] | undefined = tree.resume(this);
        let i;
        let newArr: unknown[];
        if (last instanceof Array) {
            [i, newArr] = last;
            if (status === "running") {
                this.throw(`unexpected status error`);
            } else if (status === "success") {
                newArr.push(arr[i]);
            }
            i++;
        } else {
            i = 0;
            newArr = [];
        }

        const filter = this.children[0];

        for (i = 0; i < arr.length; i++) {
            tree.blackboard.set(this.cfg.output[0], arr[i]);
            status = filter.tick(tree);
            if (status === "running") {
                if (last instanceof Array) {
                    last[0] = i;
                    last[1] = newArr;
                } else {
                    last = [i, newArr];
                }
                return tree.yield(this, last);
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
            children: 1,
            status: ["success", "failure", "|running"],
            desc: "返回满足条件的元素",
            input: ["输入数组"],
            output: ["变量", "新数组"],
            doc: `
                + 只能有一个子节点，多个仅执行第一个
                + 遍历输入数组，将当前元素写入\`变量\`，满足条件的元素放入新数组
                + 只有当新数组不为空时，才返回 \`success\`
            `,
        };
    }
}
