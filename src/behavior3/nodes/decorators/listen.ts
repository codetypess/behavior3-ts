import { type Context, type EventTarget } from "../../context";
import { Node, NodeDef, Status } from "../../node";
import { registerNode } from "../../register-node";
import { Tree, TreeEvent } from "../../tree";

const builtinEventOptions = [
    { name: "行为树被中断", value: TreeEvent.INTERRUPTED },
    { name: "行为树执行完成后", value: TreeEvent.TICKED },
    { name: "行为树被清理", value: TreeEvent.CLEANED },
];

@registerNode
export class Listen extends Node {
    declare args: { readonly event: string };

    protected _isBuiltinEvent(event: string): boolean {
        return !!builtinEventOptions.find((e) => e.value === event);
    }

    protected _processOutput(
        tree: Tree<Context, unknown>,
        eventTarget?: EventTarget,
        ...eventArgs: unknown[]
    ) {
        const [eventTargetKey] = this.cfg.output;
        if (eventTargetKey) {
            tree.blackboard.set(eventTargetKey, eventTarget);
        }
        for (let i = 1; i < this.cfg.output.length; i++) {
            const key = this.cfg.output[i];
            if (key) {
                tree.blackboard.set(key, eventArgs[i - 1]);
            }
        }
    }

    override onTick(
        tree: Tree<Context, unknown>,
        input: readonly [EventTarget | EventTarget[] | undefined],
    ): Status {
        let [target] = input;
        const args = this.args;
        // an event of the tree itself, the child still runs while the tree is torn down
        const lifecycle = this._isBuiltinEvent(args.event);

        if (lifecycle) {
            if (target !== undefined) {
                this.warn(`invalid target ${target} for builtin event ${args.event}`);
            }
            target = tree as EventTarget;
        }

        // the callback runs in the scope where it is registered, even if the scope has ended
        const callback = (eventTarget?: EventTarget) => {
            return tree.bindCallback((...eventArgs: unknown[]) => {
                if (!lifecycle && tree.__tearingDown) {
                    // the tree is being interrupted or cleared: neither the output nor the child
                    if (tree.debug) {
                        this.warn(
                            `event '${args.event}' skipped: the tree is being interrupted or cleared`,
                        );
                    }
                    return;
                }
                this._processOutput(tree, eventTarget, ...eventArgs);
                tree.__tickInCallback(this.children[0], undefined, lifecycle);
            });
        };
        if (target !== undefined) {
            if (target instanceof Array) {
                target.forEach((v) => {
                    tree.context.on(args.event, v, callback(v), tree);
                });
            } else {
                tree.context.on(args.event, target, callback(target), tree);
            }
        } else {
            tree.context.on(args.event, callback(undefined), tree);
        }

        return "success";
    }

    static override get descriptor(): NodeDef {
        return {
            name: "Listen",
            type: "Decorator",
            group: ["Core"],
            children: 1,
            status: ["success"],
            deferred: true,
            desc: "侦听事件，触发时执行子节点",
            input: ["目标对象?"],
            output: ["事件目标?", "事件参数..."],
            args: [
                {
                    name: "event",
                    type: "string",
                    desc: "事件名",
                    options: [
                        {
                            source: builtinEventOptions.slice(),
                        },
                    ],
                },
            ],
            doc: `
                + 注册侦听后立即返回 \`success\`，事件触发时执行第一个子节点，多个仅执行第一个
                + 配置了 \`目标对象\`（一个或数组）时侦听这些目标上的事件，否则侦听 Context 上的事件（\`dispatch\` 时不带目标）；内置的行为树事件固定侦听本树，不需要 \`目标对象\`
                + 事件触发时，把事件目标写入 \`事件目标\`，事件参数依次写入 \`事件参数...\`
                + 内置的行为树事件中，只有 \`行为树执行完成后\`（\`treeTicked\`）带事件参数：第一个参数是这一轮的结果，\`success\`、\`failure\` 或 \`error\`，可以写入 \`事件参数...\` 的第一个变量，再用条件节点判断；\`行为树被中断\`、\`行为树被清理\` 没有事件参数
                + 如果子节点返回 \`running\`，会被中止
                + 子节点返回 \`error\` 或抛异常时只打印日志，不影响行为树正在运行的分支
                + 每次执行都会注册一次侦听，通常放在 \`Once\` 下使用
                + 不能放在条件树里，加载时报错：条件可能被反复求值，每次都会多注册一次
                + 回调在注册时所在的作用域中执行：放在 \`Scope\` 或条件树里时，回调里写的变量只留在那个作用域里，\`Scope\` 结束后也不会写回外层；要修改外层变量，把它放在 \`Scope\` 外面
                + 侦听属于整棵树，所在分支被中止或打断后仍然有效，只有清理行为树时才会移除`,
        };
    }
}
