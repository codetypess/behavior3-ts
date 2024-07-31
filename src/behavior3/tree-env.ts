import { Context, ObjectType } from "./context";
import { Node } from "./node";
import { Status } from "./process";

const PREFIX_PRIVATE = "__PRIVATE_VAR";
const PREFIX_TEMP = "__TEMP_VAR";

export class Stack {
    private _nodes: Node[] = [];
    private _env: TreeEnv;

    constructor(env: TreeEnv) {
        this._env = env;
    }

    get length() {
        return this._nodes.length;
    }

    top(): Node | undefined {
        return this._nodes[this._nodes.length - 1];
    }

    push(node: Node) {
        this._nodes.push(node);
    }

    pop(): Node | undefined {
        const node = this._nodes.pop();
        if (node) {
            this._env.set(node.__yield, undefined);
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

export class TreeEnv<T extends Context = Context> {
    // variables of running node
    readonly input: unknown[] = [];
    readonly output: unknown[] = [];

    /** @private */
    __status: Status = "success";
    /** @private */
    __interrupted: boolean = false;

    protected _context: T;
    protected _values: ObjectType = {};
    protected _stack: Stack = new Stack(this);

    debug: boolean = false;

    constructor(context: T) {
        this._context = context;
    }

    get context() {
        return this._context;
    }

    get status() {
        return this.__status;
    }

    get vars() {
        return this._values;
    }

    get stack() {
        return this._stack;
    }

    eval(code: string) {
        return this.context.compileCode(code)(this._values);
    }

    get(k: string) {
        if (k) {
            return this._values[k];
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
        this.__interrupted = false;
        this.__status = "success";
        this._stack.clear();
        this._values = {};
        this.debug = false;
        this.input.length = 0;
        this.output.length = 0;

        this.context.offAll(this);
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
