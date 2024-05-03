import { Tree } from "./tree";
import { TreeEnv } from "./tree-env";
import { Process, Status } from "./process";

export interface NodeDef {
    name: string;
    type: "Action" | "Decorator" | "Condition" | "Composite";
    desc: string;
    input?: string[];
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
        options?: { name: string; value: unknown }[];
    }[];
    output?: string[];
    doc?: string;
}

export interface NodeData {
    id: number;
    name: string;
    desc: string;
    args: unknown;
    debug?: boolean;
    input?: ReadonlyArray<string>;
    output?: ReadonlyArray<string>;
    children?: ReadonlyArray<NodeData>;
}

export class Node {
    readonly tree: Tree;
    readonly name: string;
    readonly id: number;
    readonly info: string;
    readonly args: unknown;
    readonly data: NodeData;
    readonly children: Node[] = [];

    private _process: Process;
    private _yield: string;

    constructor(data: NodeData, tree: Tree) {
        this.tree = tree;
        this.name = data.name;
        this.id = data.id;
        this.info = `node ${tree.name}.${this.id}.${this.name}`;

        this.data = data;
        this.args = data.args ?? {};
        data.children?.forEach((value) => {
            this.children.push(new Node(value, tree));
        });

        const process = tree.context.resolveProcess(this.name);
        if (!process) {
            throw new Error(`behavior3: process '${this.name}' not found`);
        }
        this._process = process;
        this._process.check(this);
        this._yield = TreeEnv.makeTempVar(this, "yield");
    }

    run(env: TreeEnv) {
        if (env.getValue(this._yield) === undefined) {
            env.stack.push(this);
        }

        const data = this.data;

        env.input.length = 0;
        env.output.length = 0;

        data.input?.forEach((varName) => {
            env.input.push(env.getValue(varName));
        });

        const status = this._process.run(this, env);
        if (env.__privateInterrupted) {
            return "running";
        } else if (status != "running") {
            data.output?.forEach((varName, i) => {
                env.setValue(varName, env.output[i]);
            });
            env.setValue(this._yield, undefined);
            env.stack.pop();
        } else if (env.getValue(this._yield) === undefined) {
            env.setValue(this._yield, true);
        }

        env.__privateStatus = status;

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
                    `node:${this.id}, status:${status}, vars:{${varStr}}`
            );
        }

        return status;
    }

    yield(env: TreeEnv, value?: unknown): Status {
        env.setValue(this._yield, value ?? true);
        return "running";
    }

    resume(env: TreeEnv): unknown {
        return env.getValue(this._yield);
    }

    error(msg: string) {
        throw new Error(`${this.tree.name}->${this.name}#${this.id}: ${msg}`);
    }

    warn(msg: string) {
        console.warn(`${this.tree.name}->${this.name}#${this.id}: ${msg}`);
    }
}
