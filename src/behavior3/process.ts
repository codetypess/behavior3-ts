import { TreeEnv } from "./tree-env";

import { Node, NodeDef } from "./node";

export type Status = "success" | "failure" | "running";

export abstract class Process {
    init?(node: Node): unknown;

    protected _checkOneof<V>(
        node: Node,
        env: TreeEnv,
        inputIndex: number,
        argValue: V | undefined,
        defaultValue?: V
    ) {
        const inputValue = env.input[inputIndex];
        let value: V | undefined;
        if (node.data.input[inputIndex]) {
            if (inputValue === undefined) {
                const func = defaultValue === undefined ? node.error : node.warn;
                func(
                    `${node.tree.name}#${node.id}: missing input '${node.data.input[inputIndex]}'`
                );
            }
            value = inputValue as V;
        } else {
            value = argValue;
        }
        return (value ?? defaultValue) as V;
    }

    abstract run(node: Node, env: TreeEnv): Status;

    abstract get descriptor(): NodeDef;
}
