import { Process, Status } from "./process";
import { Tree } from "./tree";
import { TreeEnv } from "./tree-env";

export interface NodeDef {
    name: string;
    type: "Action" | "Decorator" | "Condition" | "Composite";
    desc: string;
    icon?: string;
    color?: string;
    input?: string[];
    status?: Exclude<
        `${Status}` | `!${Status}` | `|${Status}` | `&${Status}`,
        "!running" | "&running"
    >[];
    /** Allowed number of children
     * + -1: unlimited
     * + 0: no children
     * + 1: exactly one child
     */
    children?: -1 | 0 | 1;
    args?: {
        name: string;
        type:
            | "boolean"
            | "boolean?"
            | "int"
            | "int?"
            | "float"
            | "float?"
            | "enum"
            | "enum?"
            | "string"
            | "string?"
            | "code"
            | "code?";
        desc: string;
        default?: unknown;
        options?: { name: string; value: unknown }[];
    }[];
    output?: string[];
    doc?: string;
}

export interface NodeData {
    id: number;
    name: string;
    desc: string;
    args: { [k: string]: unknown };
    debug?: boolean;
    disabled?: boolean;
    input: ReadonlyArray<string>;
    output: ReadonlyArray<string>;
    children: ReadonlyArray<NodeData>;
}

export interface NodeVars {
    readonly yieldKey: string;
}

export class Node {
    readonly vars: NodeVars;
    readonly tree: Tree;
    readonly name: string;
    readonly id: number;
    readonly info: string;
    readonly args: { [k: string]: unknown };
    readonly data: NodeData;
    readonly children: Node[] = [];

    private _process: Process;

    constructor(data: NodeData, tree: Tree) {
        this.data = data;
        this.data.args = this.data.args ?? {};
        this.data.input = this.data.input ?? [];
        this.data.output = this.data.output ?? [];
        this.data.children = this.data.children ?? [];
        this.tree = tree;
        this.name = data.name;
        this.id = data.id;
        this.info = `node ${tree.name}.${this.id}.${this.name}`;
        this.vars = { yieldKey: TreeEnv.makeTempVar(this, "YIELD") } as NodeVars;
        this.args = data.args;
        data.children?.forEach((value) => {
            if (!value.disabled) {
                this.children.push(new Node(value, tree));
            }
        });

        const process = tree.context.findProcess(this.name);
        if (!process) {
            throw new Error(`behavior3: process '${this.name}' not found`);
        }
        this._process = process;
        this._process.init(this);
    }

    run(env: TreeEnv) {
        const yieldKey = this.vars.yieldKey;
        if (env.get(yieldKey) === undefined) {
            env.stack.push(this);
        }

        const data = this.data;

        env.input.length = 0;
        env.output.length = 0;

        data.input?.forEach((varName) => {
            env.input.push(env.get(varName));
        });

        const status = this._process.run(this, env);
        if (env.__interrupted) {
            return "running";
        } else if (status !== "running") {
            data.output?.forEach((varName, i) => {
                env.set(varName, env.output[i]);
            });
            env.set(yieldKey, undefined);
            env.stack.pop();
        } else if (env.get(yieldKey) === undefined) {
            env.set(yieldKey, true);
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
        env.set(this.vars.yieldKey, value ?? true);
        return "running";
    }

    resume(env: TreeEnv): unknown {
        return env.get(this.vars.yieldKey);
    }

    error(msg: string) {
        throw new Error(`${this.tree.name}->${this.name}#${this.id}: ${msg}`);
    }

    warn(msg: string) {
        console.warn(`${this.tree.name}->${this.name}#${this.id}: ${msg}`);
    }
}
