import { ObjectType } from "./context";
import { Process, Status } from "./process";
import { Tree } from "./tree";
import { TreeEnv } from "./tree-env";

export interface NodeDef {
    name: string;
    /**
     * Recommended type used for the node definition:
     * + `Action`: No children allowed, returns `success`, `failure` or `running`.
     * + `Decorator`: Only one child allowed, returns `success`, `failure` or `running`.
     * + `Composite`: Contains more than one child, returns `success`, `failure` or `running`.
     * + `Condition`: No children allowed, no output, returns `success` or `failure`.
     */
    type: "Action" | "Decorator" | "Condition" | "Composite";
    desc: string;
    /** ["input1?", "input2..."] */
    input?: string[];
    /** ["output1", "output2..."] */
    output?: string[];
    args?: {
        name: string;
        type:
            | "boolean"
            | "boolean?"
            | "boolean[]"
            | "boolean[]?"
            | "int"
            | "int?"
            | "int[]"
            | "int[]?"
            | "float"
            | "float?"
            | "float[]"
            | "float[]?"
            | "string"
            | "string?"
            | "string[]"
            | "string[]?"
            | "json"
            | "json?"
            | "json[]"
            | "json[]?"
            | "enum"
            | "enum?"
            | "enum[]"
            | "enum[]?"
            | "code"
            | "code?"
            | "code[]"
            | "code[]?";
        desc: string;
        /** Input `value`, only one is allowed between `value` and this arg.*/
        oneof?: string;
        default?: unknown;
        options?: { name: string; value: unknown; desc?: string }[];
    }[];
    doc?: string;
    icon?: string;
    color?: string;
    /**
     * Used in Behavior3 Editor, to help editor deduce the status of the node.
     *
     * + `!success`  !(child_success|child_success|...)
     * + `!failure`  !(child_failure|child_failure|...)
     * + `|success`  child_success|child_success|...
     * + `|failure`  child_failure|child_failure|...
     * + `|running`  child_running|child_running|...
     * + `&success`  child_success&child_success&...
     * + `&failure`  child_failure&child_failure&...
     */
    status?: (
        | "success"
        | "failure"
        | "running"
        | "!success"
        | "!failure"
        | "|success"
        | "|failure"
        | "|running"
        | "&success"
        | "&failure"
    )[];
    /**
     * Used in Behavior3 Editor, to help editor alert error when the num of children is wrong.
     *
     * Allowed number of children
     * + -1: unlimited
     * + 0: no children
     * + 1: exactly one
     * + 3: exactly three children (ifelse)
     */
    children?: -1 | 0 | 1 | 3;
}

export interface NodeData {
    readonly id: number;
    readonly name: string;
    readonly desc: string;
    readonly args?: { readonly [k: string]: unknown };
    readonly debug?: boolean;
    readonly disabled?: boolean;
    readonly input?: Readonly<string[]>;
    readonly output?: Readonly<string[]>;
    readonly children?: Readonly<NodeData[]>;
}

export class Node {
    readonly consts: Readonly<ObjectType>;
    readonly tree: Tree;
    readonly args: { readonly [k: string]: unknown };
    readonly input: Readonly<string[]>;
    readonly output: Readonly<string[]>;
    readonly children: Readonly<Node[]>;

    private _process: Process;
    private _data: NodeData;
    private _yield?: string;

    constructor(data: NodeData, tree: Tree) {
        this._data = data;
        this.tree = tree;
        this.args = data.args ?? {};
        this.input = data.input ?? [];
        this.output = data.output ?? [];
        this.children =
            data.children
                ?.filter((value) => !value.disabled)
                .map((value) => new Node(value, tree)) ?? [];

        const process = tree.context.findProcess(this.name);
        if (!process) {
            throw new Error(`behavior3: process '${this.name}' not found`);
        }
        this._process = process;
        this.consts = this._process.init?.(this) ?? ({} as Readonly<ObjectType>);

        const descriptor = process.descriptor;
        if (
            descriptor.children !== undefined &&
            descriptor.children !== -1 &&
            descriptor.children !== this.children.length
        ) {
            if (descriptor.children === 0) {
                this.warn(`no children is required`);
            } else if (this.children.length < descriptor.children) {
                this.error(`at least ${descriptor.children} children are required`);
            } else {
                this.warn(`exactly ${descriptor.children} children`);
            }
        }
    }

    /** @private */
    get __yield() {
        return (this._yield ||= TreeEnv.makeTempVar(this, "YIELD"));
    }

    get id() {
        return this._data.id;
    }

    get name() {
        return this._data.name;
    }

    tick(env: TreeEnv) {
        if (env.stack.top() !== this) {
            env.stack.push(this);
        }

        const data = this._data;

        env.input.length = 0;
        env.output.length = 0;

        data.input?.forEach((varName) => {
            env.input.push(env.get(varName));
        });

        const status = this._process.tick(this, env);
        if (env.__interrupted) {
            return "running";
        } else if (status !== "running") {
            data.output?.forEach((varName, i) => {
                env.set(varName, env.output[i]);
            });
            env.stack.pop();
        } else if (env.get(this.__yield) === undefined) {
            env.set(this.__yield, true);
        }

        env.__status = status;

        if (data.debug || env.debug) {
            let varStr = "";
            for (const k in env.vars) {
                if (!(TreeEnv.isTempVar(k) || TreeEnv.isPrivateVar(k))) {
                    varStr += `${k}:${env.vars[k]}, `;
                }
            }
            const indent = env.debug ? " ".repeat(env.stack.length) : "";
            console.debug(
                `[DEBUG] behavior3 -> ${indent}${this.name}: tree:${this.tree.name}, ` +
                    `node:${this.id}, status:${status}, vars:{${varStr}} args:{${JSON.stringify(
                        data.args
                    )}}`
            );
        }

        return status;
    }

    yield(env: TreeEnv, value?: unknown): Status {
        env.set(this.__yield, value ?? true);
        return "running";
    }

    resume(env: TreeEnv): unknown {
        return env.get(this.__yield);
    }

    error(msg: string) {
        throw new Error(`${this.tree.name}->${this.name}#${this.id}: ${msg}`);
    }

    warn(msg: string) {
        console.warn(`${this.tree.name}->${this.name}#${this.id}: ${msg}`);
    }
}
