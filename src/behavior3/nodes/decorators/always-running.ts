import { Node } from "../../node";
import { Process, Status } from "../../process";
import { TreeEnv } from "../../tree-env";

export class AlwaysRunning extends Process {
    constructor() {
        super({
            name: "AlwaysRunning",
            type: "Decorator",
            children: 1,
            status: ["running"],
            desc: "始终返回运行中状态",
            doc: `
                + 只能有一个子节点，多个仅执行第一个
                + 始终返回 \`running\`
            `,
        });
    }

    override tick(node: Node, env: TreeEnv): Status {
        node.children[0].tick(env);
        return "running";
    }
}
