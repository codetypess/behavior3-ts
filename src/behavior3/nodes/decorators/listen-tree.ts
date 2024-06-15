import { Node, NodeDef } from "../../node";
import { Process, Status } from "../../process";
import { TreeEvent } from "../../tree";
import { TreeEnv } from "../../tree-env";

interface NodeArgs {
    builtin: string;
}

export class ListenTree extends Process {
    override init(node: Node): void {
        if (node.children.length === 0) {
            node.error(`${node.tree.name}#${node.id}: at least one children`);
        }
    }

    override run(node: Node, env: TreeEnv): Status {
        const args = node.args as unknown as NodeArgs;
        env.treeRunner.on(args.builtin, () => {
            const level = env.stack.length;
            const status = node.children[0].run(env);
            if (status === "running") {
                while (env.stack.length > level) {
                    const child = env.stack.pop()!;
                    env.set(child.vars.yieldKey, undefined);
                }
            }
        });
        return "success";
    }

    override get descriptor(): NodeDef {
        return {
            name: "ListenTree",
            type: "Decorator",
            desc: "侦听行为树事件",
            args: [
                {
                    name: "builtin",
                    type: "enum",
                    desc: "事件",
                    options: [
                        {
                            name: "行为树被中断",
                            value: TreeEvent.INTERRUPTED,
                        },
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
                    ],
                },
            ],
            doc: `
                + 当事件触发时，执行第一个子节点，多个仅执行第一个
                + 如果子节点返回 「运行中」，会中断执行并清理执行栈`,
        };
    }
}
