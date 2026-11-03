import { type Context } from "../../context";
import { Node, NodeDef, Status } from "../../node";
import { registerNode } from "../../register-node";
import { Tree } from "../../tree";

@registerNode
export class Delay extends Node {
    declare args: {
        readonly delay: number;
        readonly cacheVars?: Readonly<string[]>;
    };

    override onTick(tree: Tree<Context, unknown>): Status {
        const args = this.args;
        const delay = this._checkOneof(0, args.delay, 0);
        const blackboard = tree.blackboard;
        const keys = args.cacheVars ?? [];
        const cacheArgs: unknown[] = keys.map((key) => blackboard.get(key));

        tree.context.delay(
            delay,
            // the callback runs in the scope where it is registered, even if the scope has ended
            tree.bindCallback(() => {
                const cacheOldArgs: unknown[] = keys.map((key) => blackboard.get(key));
                keys.forEach((key, i) => blackboard.set(key, cacheArgs[i]));
                tree.__tickInCallback(this.children[0]);
                keys.forEach((key, i) => blackboard.set(key, cacheOldArgs[i]));
            }),
            tree
        );
        return "success";
    }

    static override get descriptor(): NodeDef {
        return {
            name: "Delay",
            type: "Decorator",
            group: ["Core"],
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
                + 如果子节点返回 \`running\`，会被中止
                + 子节点返回 \`error\` 或抛异常时只打印日志，不影响行为树正在运行的分支
                + 回调在注册时所在的作用域中执行：放在 \`Scope\` 或条件树里时，回调里写的变量只留在那个作用域里，\`Scope\` 结束后也不会写回外层；要修改外层变量，把它放在 \`Scope\` 外面
                + 定时器属于整棵树，所在分支被中止或打断后仍会触发，只有清理行为树时才会移除`,
        };
    }
}
