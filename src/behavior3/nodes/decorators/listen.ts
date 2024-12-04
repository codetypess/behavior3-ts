import { TargetType } from "../../context";
import { Node } from "../../node";
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
    {
        name: "行为树被清理",
        value: TreeEvent.CLEANED,
    },
];

type NodeInput = [TargetType | TargetType[] | undefined];
type NodeOutput = [string?, string?];

export class Listen extends Process {
    constructor() {
        super({
            name: "Listen",
            type: "Decorator",
            children: 1,
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
                + 如果子节点返回 \`running\`，会中断执行并清理执行栈`,
        });
    }

    protected _isBuiltinEvent(event: string): boolean {
        return !!builtinEventOptions.find((e) => e.value === event);
    }

    protected _processOutput(
        node: Node,
        env: TreeEnv,
        eventTarget?: TargetType,
        ...eventArgs: unknown[]
    ) {
        const [eventArgsKey, eventTargetKey] = node.output as NodeOutput;
        if (eventTargetKey) {
            env.set(eventTargetKey, eventTarget);
        }
        if (eventArgsKey) {
            env.set(eventArgsKey, eventArgs);
        }
    }

    override tick(node: Node, env: TreeEnv): Status {
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
                this._processOutput(node, env, eventTarget, ...eventArgs);
                const level = env.stack.length;
                const status = node.children[0].tick(env);
                if (status === "running") {
                    env.stack.popTo(level);
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
}
