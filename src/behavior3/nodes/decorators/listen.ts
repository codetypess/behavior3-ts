import type { Context, TargetType } from "../../context";
import { Node, NodeDef, Status } from "../../node";
import { Tree, TreeEvent } from "../../tree";

const builtinEventOptions = [
    { name: "行为树被中断", value: TreeEvent.INTERRUPTED },
    { name: "行为树开始执行前", value: TreeEvent.BEFORE_TICKED },
    { name: "行为树执行完成后", value: TreeEvent.AFTER_TICKED },
    { name: "行为树执行成功后", value: TreeEvent.TICKED_SUCCESS },
    { name: "行为树执行失败后", value: TreeEvent.TICKED_FAILURE },
    { name: "行为树被清理", value: TreeEvent.CLEANED },
];

export class Listen extends Node {
    declare args: { readonly event: string };
    declare input: [TargetType | TargetType[] | undefined];
    declare output: [
        target?: string,
        arg0?: string,
        arg1?: string
        // argN?:string
    ];

    protected _isBuiltinEvent(event: string): boolean {
        return !!builtinEventOptions.find((e) => e.value === event);
    }

    protected _processOutput(
        tree: Tree<Context, unknown>,
        eventTarget?: TargetType,
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

    override onTick(tree: Tree<Context, unknown>, status: Status): Status {
        let [target] = this.input;
        const args = this.args;

        if (this._isBuiltinEvent(args.event)) {
            if (target !== undefined) {
                this.warn(`invalid target ${target} for builtin event ${args.event}`);
            }
            target = tree as TargetType;
        }

        const callback = (eventTarget?: TargetType) => {
            return (...eventArgs: unknown[]) => {
                this._processOutput(tree, eventTarget, ...eventArgs);
                const level = tree.stack.length;
                status = this.children[0].tick(tree);
                if (status === "running") {
                    tree.stack.popTo(level);
                }
            };
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
            children: 1,
            status: ["success"],
            desc: "侦听事件",
            input: ["目标对象?"],
            output: ["事件目标?", "事件参数..."],
            args: [
                {
                    name: "event",
                    type: "string",
                    desc: "事件",
                    options: builtinEventOptions.slice(),
                },
            ],
            doc: `
                + 当事件触发时，执行第一个子节点，多个仅执行第一个
                + 如果子节点返回 \`running\`，会中断执行并清理执行栈`,
        };
    }
}
