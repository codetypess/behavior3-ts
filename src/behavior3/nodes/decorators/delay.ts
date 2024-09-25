import { Node, NodeDef } from "../../node";
import { Process, Status } from "../../process";
import { TreeEnv } from "../../tree-env";

interface NodeArgs {
    readonly delay: number;
    readonly cache_args?: Readonly<string[]>;
}

export class Delay extends Process {
    override run(node: Node, env: TreeEnv): Status {
        const args = node.args as unknown as NodeArgs;
        const delay = this._checkOneof(node, env, 0, args.delay, 0);

        const keys = args.cache_args ?? [];
        const cacheArgs: unknown[] = keys.map((key) => env.get(key));

        env.context.delay(
            delay,
            () => {
                const cacheOldArgs: unknown[] = keys.map((key) => env.get(key));
                keys.forEach((key, i) => env.set(key, cacheArgs[i]));
                const level = env.stack.length;
                const status = node.children[0].run(env);
                if (status === "running") {
                    env.stack.popTo(level);
                }
                keys.forEach((key, i) => env.set(key, cacheOldArgs[i]));
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
                {
                    name: "cache_args",
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
