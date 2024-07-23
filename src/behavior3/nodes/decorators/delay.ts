import { Node, NodeDef } from "../../node";
import { Process, Status } from "../../process";
import { TreeEnv } from "../../tree-env";

interface NodeArgs {
    delay: number;
}

export class Delay extends Process {
    override run(node: Node, env: TreeEnv): Status {
        const args = node.args as unknown as NodeArgs;
        const delay = this._checkOneof(node, env, 0, args.delay, 0);
        env.context.delay(
            delay,
            () => {
                const level = env.stack.length;
                const status = node.children[0].run(env);
                if (status === "running") {
                    env.stack.popTo(level);
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
            ],
            doc: `
                + 当延时触发时，执行第一个子节点，多个仅执行第一个
                + 如果子节点返回 \`running\`，会中断执行并清理执行栈`,
        };
    }
}
