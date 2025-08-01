import { Blackboard } from "./blackboard";
import type { Context, DeepReadonly, NodeContructor, ObjectType } from "./context";
import type { Tree, TreeData } from "./tree";

export type Status = "success" | "failure" | "running" | "error";

export interface NodeDef<GroupType extends string = string> {
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
            | "bool"
            | "bool?"
            | "bool[]"
            | "bool[]?"
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
            | "expr"
            | "expr?"
            | "expr[]"
            | "expr[]?";
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
     * Used in Behavior3 Editor, to help editor manage available nodes in file tree.
     */
    group?: GroupType[];
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
     * + 2: exactly two (case)
     * + 3: exactly three children (ifelse)
     */
    children?: -1 | 0 | 1 | 2 | 3;
}

export interface NodeData {
    id: string;
    name: string;
    desc: string;
    args: { [k: string]: unknown };
    debug?: boolean;
    disabled?: boolean;
    input: string[];
    output: string[];
    children: NodeData[];

    tree: TreeData;
}

export abstract class Node {
    readonly args: unknown = {};
    readonly input: unknown[] = [];
    readonly output: unknown[] = [];

    protected readonly _context: Context;

    private _parent: Node | null = null;
    private _children: Node[] = [];
    private _cfg: DeepReadonly<NodeData>;
    private _yield?: string;
    private _stringifiedArgs: Record<string, string> | undefined;

    constructor(context: Context, cfg: NodeData) {
        this._context = context;
        this._cfg = cfg;
        Object.keys(cfg.args).forEach((k) => {
            const value = cfg.args[k];
            if (value && typeof value === "object") {
                this._stringifiedArgs = this._stringifiedArgs ?? {};
                this._stringifiedArgs[k] = JSON.stringify(value);
            } else {
                (this.args as ObjectType)[k] = value;
            }
        });

        for (const childCfg of cfg.children) {
            if (!childCfg.disabled) {
                const child = Node.create(context, childCfg);
                child._parent = this;
                this._children.push(child);
            }
        }
    }

    /** @private */
    get __yield() {
        return (this._yield ||= Blackboard.makeTempVar(this, "YIELD"));
    }

    get cfg() {
        return this._cfg;
    }

    get id() {
        return this.cfg.id;
    }

    get name() {
        return this.cfg.name;
    }

    get parent() {
        return this._parent;
    }

    get children(): Readonly<Node[]> {
        return this._children;
    }

    tick(tree: Tree<Context, unknown>): Status {
        const { stack, blackboard } = tree;
        const { cfg, input, output, args } = this;

        if (stack.top() !== this) {
            stack.push(this);
        }

        input.length = 0;
        output.length = 0;

        cfg.input.forEach((k, i) => (input[i] = blackboard.get(k)));

        if (this._stringifiedArgs) {
            for (const k in this._stringifiedArgs) {
                (args as ObjectType)[k] = JSON.parse(this._stringifiedArgs[k]);
            }
        }

        let status: Status = "failure";
        try {
            status = this.onTick(tree, tree.__lastStatus);
        } catch (e) {
            if (e instanceof Error) {
                this.error(`${e.message}\n ${e.stack}`);
            } else {
                console.error(e);
            }
            tree.interrupt();
        }

        if (tree.__interrupted) {
            return "running";
        } else if (status !== "running") {
            cfg.output.forEach((k, i) => blackboard.set(k, output[i]));
            stack.pop();
        } else if (blackboard.get(this.__yield) === undefined) {
            blackboard.set(this.__yield, true);
        }

        tree.__lastStatus = status;

        if (cfg.debug || tree.debug) {
            let varStr = "";
            for (const k in blackboard.values) {
                if (!(Blackboard.isTempVar(k) || Blackboard.isPrivateVar(k))) {
                    varStr += `${k}:${blackboard.values[k]}, `;
                }
            }
            const indent = tree.debug ? " ".repeat(stack.length) : "";
            console.info(
                `[DEBUG] behavior3 -> ${indent}${this.name}: tree:${this.cfg.tree.name} tree_id:${tree.id}, ` +
                    `node:${this.id}, status:${status}, values:{${varStr}} args:${JSON.stringify(
                        cfg.args
                    )}`
            );
        }

        return status;
    }

    assert(condition: unknown, msg: string): asserts condition {
        if (!condition) {
            this.throw(msg);
        }
    }

    /**
     * throw an error
     */
    throw(msg: string): never {
        throw new Error(`${this.cfg.tree.name}->${this.name}#${this.id}: ${msg}`);
    }

    /**
     * use console.error to print error message
     */
    error(msg: string) {
        console.error(`${this.cfg.tree.name}->${this.name}#${this.id}: ${msg}`);
    }

    /**
     * use console.warn to print warning message
     */
    warn(msg: string) {
        console.warn(`${this.cfg.tree.name}->${this.name}#${this.id}: ${msg}`);
    }

    /**
     * use console.debug to print debug message
     */
    debug(msg: string) {
        console.debug(`${this.cfg.tree.name}->${this.name}#${this.id}: ${msg}`);
    }

    /**
     * use console.info to print info message
     */

    info(msg: string) {
        console.info(`${this.cfg.tree.name}->${this.name}#${this.id}: ${msg}`);
    }

    protected _checkOneof<V>(inputIndex: number, argValue: V | undefined, defaultValue?: V) {
        const inputValue = this.input[inputIndex];
        const inputName = this.cfg.input[inputIndex];
        let value: V | undefined;
        if (inputName) {
            if (inputValue === undefined) {
                const func = defaultValue === undefined ? this.throw : this.warn;
                func.call(this, `missing input '${inputName}'`);
            }
            value = inputValue as V;
        } else {
            value = argValue;
        }
        return (value ?? defaultValue) as V;
    }

    /**
     * Executes the node's behavior tree logic.
     * @param tree The behavior tree instance
     * @param status The status of the last node
     * @returns The execution status: `success`, `failure`, or `running`
     */
    abstract onTick(tree: Tree<Context, unknown>, status: Status): Status;

    static get descriptor(): NodeDef {
        throw new Error(`descriptor not found in '${this.name}'`);
    }

    static create(context: Context, cfg: NodeData) {
        const NodeCls = context.nodeCtors[cfg.name] as NodeContructor<Node> | undefined;
        const descriptor = context.nodeDefs[cfg.name] as NodeDef | undefined;

        if (!NodeCls || !descriptor) {
            throw new Error(`behavior3: node '${cfg.tree.name}->${cfg.name}' is not registered`);
        }

        const node = new NodeCls(context, cfg);

        if (node.tick !== Node.prototype.tick) {
            throw new Error("don't override 'tick' function");
        }

        if (
            descriptor.children !== undefined &&
            descriptor.children !== -1 &&
            descriptor.children !== node.children.length
        ) {
            if (descriptor.children === 0) {
                node.warn(`no children is required`);
            } else if (node.children.length < descriptor.children) {
                node.throw(`at least ${descriptor.children} children are required`);
            } else {
                node.warn(`exactly ${descriptor.children} children`);
            }
        }

        return node;
    }
}
