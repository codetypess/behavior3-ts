import { TreeEnv } from "./tree-env";

import { Node, NodeDef } from "./node";

export type Status = "success" | "failure" | "running";

export abstract class Process {
    init(node: Node): void {}

    protected _checkOneChild(node: Node) {
        if (node.children.length !== 1) {
            if (node.children.length === 0) {
                node.error(`${node.tree.name}#${node.id}: at least one children`);
            } else {
                node.warn(`${node.tree.name}#${node.id}: exactly one children`);
            }
        }
    }

    abstract run(node: Node, env: TreeEnv): Status;

    abstract get descriptor(): NodeDef;
}
