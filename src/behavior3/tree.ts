import { Context } from "./context";
import { Node, NodeData } from "./node";

export interface TreeData {
    name: string;
    desc: string;
    root: NodeData;
}

export class Tree {
    readonly name: string;
    readonly root: Node;
    readonly context: Context;

    constructor(context: Context, data: TreeData) {
        this.name = data.name;
        this.context = context;
        this.root = new Node(data.root, this);
    }
}
