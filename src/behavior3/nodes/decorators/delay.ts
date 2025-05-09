import type { Context } from "../../context";
import { Node, NodeDef, Status } from "../../node";
import { Tree } from "../../tree";

export class Delay extends Node {
    declare args: {
        readonly delay: number;
        readonly cacheVars?: Readonly<string[]>;
    };

    override onTick(tree: Tree<Context, unknown>, status: Status): Status {
        const args = this.args;
        const delay = this._checkOneof(0, args.delay, 0);
        const blackboard = tree.blackboard;
        const keys = args.cacheVars ?? [];
        const cacheArgs: unknown[] = keys.map((key) => blackboard.get(key));

        tree.context.delay(
            delay,
            () => {
                const cacheOldArgs: unknown[] = keys.map((key) => blackboard.get(key));
                keys.forEach((key, i) => blackboard.set(key, cacheArgs[i]));
                const level = tree.stack.length;
                status = this.children[0].tick(tree);
                if (status === "running") {
                    tree.stack.popTo(level);
                }
                keys.forEach((key, i) => blackboard.set(key, cacheOldArgs[i]));
            },
            tree
        );
        return "success";
    }

    static override get descriptor(): NodeDef {
        return {
            name: "Delay",
            type: "Decorator",
            children: 1,
            status: ["success"],
            desc: "延时执行子节点",
            input: ["延时时间?"],
            args: [
                {
                    name: "delay",
                    type: "float?",
                    desc: "延时时间",
                    oneof: "延时时间",
                },
                {
                    name: "cacheVars",
                    type: "string[]?",
                    desc: "暂存环境变量",
                },
            ],
            doc: `
                + 当延时触发时，执行第一个子节点，多个仅执行第一个
                + 如果子节点返回 \`running\`，会中断执行并清理执行栈`,
        };
    }
}
