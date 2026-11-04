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
                // a variable inherited from an outer scope is unset rather than written back,
                // otherwise it would become a variable of this scope and hide the outer one
                const owned = keys.map((key) => blackboard.hasOwn(key));
                const cacheOldArgs: unknown[] = keys.map((key) => blackboard.get(key));
                keys.forEach((key, i) => blackboard.set(key, cacheArgs[i]));
                tree.__tickInCallback(this.children[0]);
                keys.forEach((key, i) => {
                    if (owned[i]) {
                        blackboard.set(key, cacheOldArgs[i]);
                    } else {
                        blackboard.unset(key);
                    }
                });
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
            deferred: true,
            desc: "延时执行子节点，自身立即返回成功",
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
                    desc: "暂存的变量",
                },
            ],
            doc: `
                + 注册一个定时器后立即返回 \`success\`，延时到了再执行第一个子节点，多个仅执行第一个
                + \`暂存的变量\`：注册时记下这些变量的值，执行子节点时临时换回这些值，执行完再恢复
                + 如果子节点返回 \`running\`，会被中止
                + 子节点返回 \`error\` 或抛异常时只打印日志，不影响行为树正在运行的分支
                + 回调在注册时所在的作用域中执行：放在 \`Scope\` 或条件树里时，回调里写的变量只留在那个作用域里，\`Scope\` 结束后也不会写回外层；要修改外层变量，把它放在 \`Scope\` 外面
                + 不能放在条件树里，加载时报错：条件可能被反复求值，每次都会多注册一次
                + 定时器属于整棵树，所在分支被中止或打断后仍会触发，只有清理行为树时才会移除`,
        };
    }
}
