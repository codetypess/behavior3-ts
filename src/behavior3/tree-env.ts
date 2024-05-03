import { Context } from "./context";
import { Node } from "./node";
import { Status } from "./process";

export type ObjectType = { [k: string]: unknown };

const PRIVATE_PREFIX = "__PRIVATE_VAR";
const TEMP_PREFIX = "__TEMP_VAR";

export class TreeEnv {
    readonly context: Context;

    // variables of running node
    readonly input: unknown[] = [];
    readonly output: unknown[] = [];
    __privateStatus: Status = "success";
    __privateInterrupted: boolean = false;

    private _values: ObjectType = {};
    private _stack: Node[] = [];

    debug: boolean = false;

    constructor(context: Context) {
        this.context = context;
    }

    get status() {
        return this.__privateStatus;
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

    getValue(k: string) {
        if (k) {
            return this._values[k];
        } else {
            return undefined;
        }
    }

    setValue(k: string, v: unknown) {
        if (k) {
            if (v === undefined || v === null) {
                delete this._values[k];
            } else {
                this._values[k] = v;
            }
        }
    }

    clear() {
        this._stack.length = 0;
        this._values = {};
        this.input.length = 0;
        this.output.length = 0;
    }

    static makePrivateVar(k: string): string;

    static makePrivateVar(node: Node, k: string): string;

    static makePrivateVar(node: Node | string, k?: string) {
        if (typeof node === "string") {
            return `${PRIVATE_PREFIX}_${node}`;
        } else {
            return `${PRIVATE_PREFIX}_NODE#${node.id}_${k}`;
        }
    }

    static isPrivateVar(k: string) {
        return k.startsWith(PRIVATE_PREFIX);
    }

    static makeTempVar(node: Node, k: string) {
        return `${TEMP_PREFIX}_NODE#${node.id}_${k}`;
    }

    static isTempVar(k: string) {
        return k.startsWith(TEMP_PREFIX);
    }
}
