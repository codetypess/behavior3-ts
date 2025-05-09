import type { Context } from "./context";
import type { Node } from "./node";
import { Tree } from "./tree";

export class Stack {
    private _nodes: Node[] = [];
    private _tree: Tree<Context, unknown>;

    constructor(tree: Tree<Context, unknown>) {
        this._tree = tree;
    }

    get length() {
        return this._nodes.length;
    }

    indexOf(node: Node) {
        return this._nodes.indexOf(node);
    }

    top(): Node | undefined {
        const nodes = this._nodes;
        return nodes[nodes.length - 1];
    }

    push(node: Node) {
        this._nodes.push(node);
    }

    pop(): Node | undefined {
        const node = this._nodes.pop();
        if (node) {
            this._tree.blackboard.set(node.__yield, undefined);
        }
        return node;
    }

    popTo(index: number) {
        while (this._nodes.length > index) {
            this.pop();
        }
    }

    move(dest: Stack, start: number, count: number) {
        dest._nodes.push(...this._nodes.splice(start, count));
    }

    clear() {
        this.popTo(0);
    }
}
