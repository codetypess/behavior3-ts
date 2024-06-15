import { TargetType } from "../../context";
import { Node, NodeDef } from "../../node";
import { Process, Status } from "../../process";
import { TreeEnv } from "../../tree-env";

interface NodeArgs {
    event: string;
}

type NodeInput = [TargetType | TargetType[] | undefined];
type NodeOutput = [string?];

export class Listen extends Process {
    override init(node: Node): void {
        if (node.children.length === 0) {
            node.error(`${node.tree.name}#${node.id}: at least one children`);
        }
    }

    override run(node: Node, env: TreeEnv): Status {
        const [target] = env.input as NodeInput;
        const callback = (...args: unknown[]) => {
            const level = env.stack.length;
            const [argsKey] = node.data.output as unknown as NodeOutput;
            if (argsKey) {
                env.set(argsKey, args);
            }
            const status = node.children[0].run(env);
            if (status === "running") {
                while (env.stack.length > level) {
                    const child = env.stack.pop()!;
                    env.set(child.vars.yieldKey, undefined);
                }
            }
        };
        const args = node.args as unknown as NodeArgs;
        if (target !== undefined) {
            if (target instanceof Array) {
                target.forEach((v) => {
                    env.context.on(args.event, v, callback, env);
                });
            } else {
                env.context.on(args.event, target, callback, env);
            }
        } else {
            env.context.on(args.event, callback, env);
        }

        return "success";
    }

    override get descriptor(): NodeDef {
        return {
            name: "Listen",
            type: "Decorator",
            desc: "侦听事件",
            input: ["目标对象?"],
            output: ["事件参数?"],
            args: [
                {
                    name: "event",
                    type: "string",
                    desc: "事件",
                },
            ],
            doc: `
                + 当事件触发时，执行第一个子节点，多个仅执行第一个
                + 如果子节点返回 「运行中」，会中断执行并清理执行栈`,
        };
    }
}
