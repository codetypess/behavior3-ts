import type { Context, ObjectType } from "./context";
import type { Node } from "./node";
import type { Tree } from "./tree";

const PREFIX_PRIVATE = "__PRIVATE_VAR";
const PREFIX_TEMP = "__TEMP_VAR";

export class Blackboard {
    protected _values: ObjectType = {};
    protected _tree: Tree<Context, unknown>;

    constructor(tree: Tree<Context, unknown>) {
        this._tree = tree;
    }

    get values() {
        return this._values;
    }

    eval(code: string) {
        return this._tree.context.compileCode(code)(this._values);
    }

    get<T>(k: string): T | undefined {
        if (k) {
            return this._values[k] as T | undefined;
        } else {
            return undefined;
        }
    }

    set(k: string, v: unknown) {
        if (k) {
            if (v === undefined || v === null) {
                delete this._values[k];
            } else {
                this._values[k] = v;
            }
        }
    }

    clear() {
        this._values = {};
    }

    static makePrivateVar(k: string): string;

    static makePrivateVar(node: Node, k: string): string;

    static makePrivateVar(node: Node | string, k?: string) {
        if (typeof node === "string") {
            return `${PREFIX_PRIVATE}_${node}`;
        } else {
            return `${PREFIX_PRIVATE}_NODE#${node.id}_${k}`;
        }
    }

    static isPrivateVar(k: string) {
        return k.startsWith(PREFIX_PRIVATE);
    }

    static makeTempVar(node: Node, k: string) {
        return `${PREFIX_TEMP}_NODE#${node.id}_${k}`;
    }

    static isTempVar(k: string) {
        return k.startsWith(PREFIX_TEMP);
    }
}
