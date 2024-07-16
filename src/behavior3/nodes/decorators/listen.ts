import { TargetType } from "../../context";
import { Node, NodeDef } from "../../node";
import { Process, Status } from "../../process";
import { TreeEvent } from "../../tree";
import { TreeEnv } from "../../tree-env";

interface NodeArgs {
    event: string;
}

const builtinEventOptions = [
    { name: "行为树被中断", value: TreeEvent.INTERRUPTED },
    {
        name: "行为树开始执行前",
        value: TreeEvent.BEFORE_RUN,
    },
    {
        name: "行为树执行完成后",
        value: TreeEvent.AFTER_RUN,
    },
    {
        name: "行为树执行成功后",
        value: TreeEvent.AFTER_RUN_SUCCESS,
    },
    {
        name: "行为树执行失败后",
        value: TreeEvent.AFTER_RUN_FAILURE,
    },
];

type NodeInput = [TargetType | TargetType[] | undefined];
type NodeOutput = [string?, string?];

export class Listen extends Process {
    override init(node: Node): void {
        this._checkOneChild(node);
    }

    protected _isBuiltinEvent(event: string): boolean {
        return !!builtinEventOptions.find((e) => e.value === event);
    }

    override run(node: Node, env: TreeEnv): Status {
        let [target] = env.input as NodeInput;
        const args = node.args as unknown as NodeArgs;

        if (this._isBuiltinEvent(args.event)) {
            if (target !== undefined) {
                node.warn(`invalid target ${target} for builtin event ${args.event}`);
            }
            target = env as unknown as TargetType;
        }

        const callback = (eventTarget?: TargetType) => {
            return (...eventArgs: unknown[]) => {
                const level = env.stack.length;
                const [eventArgsKey, eventTargetKey] = node.data.output as unknown as NodeOutput;
                if (eventTargetKey) {
                    env.set(eventTargetKey, eventTarget);
                }
                if (eventArgsKey) {
                    env.set(eventArgsKey, eventArgs);
                }
                const status = node.children[0].run(env);
                if (status === "running") {
                    while (env.stack.length > level) {
                        const child = env.stack.pop()!;
                        env.set(child.vars.yieldKey, undefined);
                    }
                }
            };
        };
        if (target !== undefined) {
            if (target instanceof Array) {
                target.forEach((v) => {
                    env.context.on(args.event, v, callback(v), env);
                });
            } else {
                env.context.on(args.event, target, callback(target), env);
            }
        } else {
            env.context.on(args.event, callback(undefined), env);
        }

        return "success";
    }

    override get descriptor(): NodeDef {
        return {
            name: "Listen",
            type: "Decorator",
            status: ["success"],
            desc: "侦听事件",
            input: ["目标对象?"],
            output: ["事件参数?", "事件目标?"],
            args: [
                {
                    name: "event",
                    type: "enum",
                    desc: "事件",
                    options: builtinEventOptions.slice(),
                },
            ],
            doc: `
                + 当事件触发时，执行第一个子节点，多个仅执行第一个
                + 如果子节点返回 \`运行中\`，会中断执行并清理执行栈`,
        };
    }
}
