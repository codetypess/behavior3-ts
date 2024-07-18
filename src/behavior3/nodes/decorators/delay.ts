import { Node, NodeDef } from "../../node";
import { Process, Status } from "../../process";
import { TreeEnv } from "../../tree-env";

interface NodeArgs {
    delay: number;
}

type NodeInput = [number?];

export class Delay extends Process {
    override init(node: Node): void {
        this._checkOneChild(node);
    }

    override run(node: Node, env: TreeEnv): Status {
        let [delay] = env.input as NodeInput;
        const args = node.args as unknown as NodeArgs;
        delay = delay ?? args.delay;
        env.context.delay(
            delay,
            () => {
                const level = env.stack.length;
                const status = node.children[0].run(env);
                if (status === "running") {
                    while (env.stack.length > level) {
                        const child = env.stack.pop()!;
                        env.set(child.vars.yieldKey, undefined);
                    }
                }
            },
            env
        );
        return "success";
    }

    override get descriptor(): NodeDef {
        return {
            name: "Delay",
            type: "Decorator",
            status: ["success"],
            desc: "延时执行子节点",
            input: ["延时时间?"],
            args: [
                {
                    name: "delay",
                    type: "float",
                    desc: "延时时间",
                },
            ],
            doc: `
                + 当延时触发时，执行第一个子节点，多个仅执行第一个
                + 如果子节点返回 \`运行中\`，会中断执行并清理执行栈`,
        };
    }
}
