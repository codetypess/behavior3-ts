import { TreeEnv } from "./tree-env";

import { Node, NodeDef } from "./node";

export type Status = "success" | "failure" | "running";

export abstract class Process {
    check(node: Node): void {}

    abstract run(node: Node, env: TreeEnv): Status;

    abstract get descriptor(): NodeDef;
}
