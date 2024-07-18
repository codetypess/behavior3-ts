import { Node, NodeDef } from "../../node";
import { Process, Status } from "../../process";
import { TreeEnv } from "../../tree-env";

type NodeInput = [unknown[]];
type NodeOutput = [string];

export class Foreach extends Process {
    override init(node: Node): void {
        this._checkOneChild(node);
    }

    override run(node: Node, env: TreeEnv): Status {
        const [arr] = env.input as NodeInput;
        const [varname] = node.data.output as NodeOutput;
        let i = node.resume(env) as number | undefined;
        if (i !== undefined) {
            if (env.status === "running") {
                node.error(`unexpected status error`);
            } else if (env.status === "failure") {
                return "failure";
            }
            i++;
        } else {
            i = 0;
        }

        for (; i < arr.length; i++) {
            env.set(varname, arr[i]);
            const status = node.children[0].run(env);
            if (status === "running") {
                return node.yield(env, i);
            } else if (status === "failure") {
                return "failure";
            }
        }

        return "success";
    }

    override get descriptor(): NodeDef {
        return {
            name: "ForEach",
            type: "Action",
            children: 1,
            status: ["success", "|running", "|failure"],
            desc: "遍历数组",
            input: ["数组"],
            output: ["变量"],
            doc: `
                + 只能有一个子节点，多个仅执行第一个
                + 遍历输入数组，将当前元素写入\`变量\`
                + 当子节点返回\`失败\`时，退出遍历并返回\`失败\`状态
                + 执行完所有子节点后，返回\`成功\``,
        };
    }
}
