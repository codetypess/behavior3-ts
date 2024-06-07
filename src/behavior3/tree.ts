import { Callback, Context } from "./context";
import { Node, NodeData } from "./node";

export interface TreeData {
    name: string;
    desc: string;
    root: NodeData;
}

export const enum TreeEvent {
    INTERRUPTED = "interrupted",
    BEFORE_RUN = "beforeRun",
    AFTER_RUN = "afterRun",
}

export class Tree {
    readonly name: string;
    readonly root: Node;
    readonly context: Context;

    private _handlerMap: Map<string, Map<number, Callback>> = new Map();

    constructor(context: Context, data: TreeData) {
        this.name = data.name;
        this.context = context;
        this.root = new Node(data.root, this);
    }

    on(event: string, node: Node, callback: Callback) {
        let handlers = this._handlerMap.get(event);
        if (!handlers) {
            handlers = new Map();
            this._handlerMap.set(event, handlers);
        }
        handlers.set(node.id, callback);
    }

    dispatch(event: string, ...args: unknown[]) {
        const handlers = this._handlerMap.get(event);
        if (handlers) {
            handlers.forEach((handler) => {
                handler(...args);
            });
        }
    }
}
