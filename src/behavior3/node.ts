import { Blackboard } from "./blackboard";
import type { Context, NodeContructor, ObjectType } from "./context";
import type { Tree, TreeData } from "./tree";

/**
 * The status of a node.
 * + `success`: The node has completed its task successfully.
 * + `failure`: The node has failed to complete its task.
 * + `running`: The node is currently executing.
 *
 * An unexpected error, such as an input of the wrong type, is not a status, throw it with
 * `node.throw`. The tree dispatches `TreeEvent.ERROR` and is interrupted.
 */
export type Status = "success" | "failure" | "running";

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
    input?: string[] | { name: string; visible?: string; checker?: string }[];
    /** ["output1", "output2..."] */
    output?: string[] | { name: string; visible?: string; checker?: string }[];
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
        /** The name of the checker function in behavior3 editor, which is used to check the validity of the arg. */
        checker?: string;
        /** The name of the visible function in behavior3 editor, which is used to control the visibility of the arg before use. */
        visible?: string;
        default?: unknown;
        options?: Array<{
            /** Match the args of the node */
            match?: { [arg: string]: Array<unknown> };
            /** The source of the options */
            source: Array<{ name: string; value: unknown }>;
        }>;
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
    /**
     * Whether the composite node uses the order of its children as priority and checks
     * `lower`/`both` conditions of the children on the left of the running child (preemption).
     *
     * A node declaring this must call `_checkPreempt` in `onTick`.
     */
    preemptive?: boolean;
}


/**
 * When the conditions of a node are checked after entering it:
 * + `none`: only checked when entering the node.
 * + `self`: also checked every tick while the node is running, aborts the node if false.
 * + `lower`: also checked by the preemptive parent while a lower priority sibling (on the right) is running,
 *   aborts the sibling and runs this node if true.
 * + `both`: `self` and `lower`.
 */
export type AbortMode = "none" | "self" | "lower" | "both";

export interface ConditionData {
    /** Default `none`. */
    abort?: AbortMode;
    /** The condition tree, it must only return `success` or `failure`. */
    root: NodeData;
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
    conditions?: ConditionData[];

    tree: TreeData;
    /** The index of the node in the tree, assigned when the tree is created. */
    index: number;
}

export interface Condition {
    readonly abort: AbortMode;
    readonly root: Node;
}

const ABORT_MODES: readonly AbortMode[] = ["none", "self", "lower", "both"];

const deepFreeze = <T>(value: T): T => {
    if (value && typeof value === "object" && !Object.isFrozen(value)) {
        Object.freeze(value);
        Object.values(value).forEach(deepFreeze);
    }
    return value;
};

export abstract class Node {
    readonly args: unknown = {};
    readonly input: unknown[] = [];
    readonly output: unknown[] = [];
    /** The index of the node in the tree, used to store the state of the node. */
    readonly index: number;

    protected readonly _context: Context;

    private _parent: Node | null = null;
    private _children: Node[] = [];
    private _cfg: NodeData;
    private _jsonArgs: Record<string, string> | undefined;
    private _conditions: Condition[] = [];
    private _selfConditions: Condition[] = [];
    private _preemptors: number[] | undefined;

    constructor(context: Context, cfg: NodeData) {
        this._context = context;
        this._cfg = cfg;
        this.index = cfg.index;

        const descriptor = context.nodeDefs[cfg.name] as NodeDef | undefined;
        Object.keys(cfg.args).forEach((k) => {
            const value = cfg.args[k];
            if (value && typeof value === "object") {
                const type = descriptor?.args?.find((v) => v.name === k)?.type;
                if (!type || type.startsWith("json")) {
                    // json literal: a fresh copy every tick, owned by the tick
                    this._jsonArgs = this._jsonArgs ?? {};
                    this._jsonArgs[k] = JSON.stringify(value);
                } else {
                    // readonly config: shared by all trees
                    (this.args as ObjectType)[k] = deepFreeze(JSON.parse(JSON.stringify(value)));
                }
            } else {
                (this.args as ObjectType)[k] = value;
            }
        });

        for (const conditionCfg of cfg.conditions ?? []) {
            if (!conditionCfg.root || conditionCfg.root.disabled) {
                continue;
            }
            const abort = conditionCfg.abort ?? "none";
            if (!ABORT_MODES.includes(abort)) {
                this.throw(`invalid abort mode '${abort}'`);
            }
            const condition: Condition = { abort, root: Node.create(context, conditionCfg.root) };
            this._conditions.push(condition);
            if (abort === "self" || abort === "both") {
                this._selfConditions.push(condition);
            }
        }

        for (const childCfg of cfg.children) {
            if (!childCfg.disabled) {
                const child = Node.create(context, childCfg);
                child._parent = this;
                this._children.push(child);
            }
        }

        if (descriptor?.preemptive) {
            this._preemptors = [];
            this._children.forEach((child, i) => child.abortsLower && this._preemptors!.push(i));
        }
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

    get conditions(): Readonly<Condition[]> {
        return this._conditions;
    }

    /** Whether the node has `lower` or `both` conditions. */
    get abortsLower() {
        return this._conditions.some((c) => c.abort === "lower" || c.abort === "both");
    }

    /** Whether the node has `self` or `both` conditions. */
    get abortsSelf() {
        return this._selfConditions.length > 0;
    }

    /**
     * Evaluates all conditions, used when entering the node and when checking preemption.
     */
    evalConditions(tree: Tree<Context, unknown>): boolean {
        for (const condition of this._conditions) {
            if (!Node._evalCondition(tree, condition.root)) {
                return false;
            }
        }
        return true;
    }

    /**
     * Evaluates `self` and `both` conditions, used when the node is running.
     */
    evalSelfConditions(tree: Tree<Context, unknown>): boolean {
        for (const condition of this._selfConditions) {
            if (!Node._evalCondition(tree, condition.root)) {
                return false;
            }
        }
        return true;
    }

    /**
     * Ticks the node.
     *
     * Only called by the parent node or the framework, use `tree.tick()` outside. An error thrown
     * here is unwound by `tree.tick()` or the callback, a direct call just gets `failure`.
     *
     * @param tree The behavior tree instance
     * @param conditionsChecked Skips the entry check, used by the preemptive parent which has
     * just evaluated the conditions of the node.
     */
    tick(tree: Tree<Context, unknown>, conditionsChecked: boolean = false): Status {
        const { blackboard } = tree;
        const { _cfg: cfg, input, output, args } = this;

        if (tree.__interrupted) {
            // unwinding the interrupted tick, don't execute any more node
            return "running";
        } else if (tree.debug) {
            tree.__markTicked(this);
        }

        if (this._conditions.length > 0) {
            let passed: boolean;
            if (tree.isRunning(this)) {
                passed = this.evalSelfConditions(tree);
                if (!passed && !tree.__interrupted) {
                    this.abort(tree);
                }
            } else {
                passed = conditionsChecked || this.evalConditions(tree);
            }
            if (tree.__interrupted) {
                return "running";
            } else if (!passed) {
                if (cfg.debug || tree.debug) {
                    this._debugStatus(tree, "failure", " (conditions)");
                }
                return "failure";
            }
        }

        const inputKeys = cfg.input;
        input.length = inputKeys.length;
        for (let i = 0; i < inputKeys.length; i++) {
            input[i] = blackboard.get(inputKeys[i]);
        }
        output.length = 0;

        if (this._jsonArgs) {
            for (const k in this._jsonArgs) {
                (args as ObjectType)[k] = JSON.parse(this._jsonArgs[k]);
            }
        }

        tree.__runningNode = this;

        let status: Status = "failure";
        try {
            status = this.onTick(tree);
        } catch (e) {
            const error = e instanceof Error ? e : new Error(String(e));
            const msg = error.stack ?? error.message;
            if (error.message.startsWith(`${cfg.tree.name}->${this.name}#${this.id}: `)) {
                // thrown by `node.throw`, the message already has the location of the node
                console.error(msg);
            } else {
                this.error(msg);
            }
            tree.__error(this, error);
        }

        if (tree.__interrupted) {
            return "running";
        } else if (status !== "running") {
            const outputKeys = cfg.output;
            for (let i = 0; i < outputKeys.length; i++) {
                blackboard.set(outputKeys[i], output[i]);
            }
            // a finished node must not leave running children behind
            const children = this._children;
            for (let i = 0; i < children.length; i++) {
                children[i].abort(tree);
            }
            tree.__clearState(this);
        } else if (!tree.isRunning(this)) {
            tree.__markRunning(this);
        }

        if (cfg.debug || tree.debug) {
            this._debugStatus(tree, status);
        }

        return status;
    }

    /**
     * Aborts the node if it is running: aborts the running descendants first,
     * then calls `onAbort`, and clears the state of the node.
     */
    abort(tree: Tree<Context, unknown>) {
        if (!tree.isRunning(this)) {
            return;
        }
        for (const child of this._children) {
            child.abort(tree);
        }
        try {
            this.onAbort(tree);
        } catch (e) {
            if (e instanceof Error) {
                this.error(`${e.message}\n ${e.stack}`);
            } else {
                console.error(e);
            }
        }
        tree.__clearState(this);
        if (this.cfg.debug || tree.debug) {
            this._debugStatus(tree, "aborted");
        }
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

    /**
     * use console.log to print log message
     */
    log(msg: string) {
        console.log(`${this.cfg.tree.name}->${this.name}#${this.id}: ${msg}`);
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
     * Checks whether a child on the left of the running child can preempt it, only available
     * for the node declared `preemptive` in its descriptor.
     *
     * Checks the children with `lower`/`both` conditions from left to right, evaluating all
     * of their conditions, the first one passed wins.
     *
     * @param tree The behavior tree instance
     * @param running The index of the running child
     * @returns The index of the child to run, `running` if no child preempts it
     */
    protected _checkPreempt(tree: Tree<Context, unknown>, running: number): number {
        const preemptors = this._preemptors;
        if (preemptors) {
            for (const i of preemptors) {
                if (i >= running) {
                    break;
                }
                if (this._children[i].evalConditions(tree)) {
                    return i;
                }
            }
        }
        return running;
    }

    private _debugStatus(tree: Tree<Context, unknown>, status: string, extra: string = "") {
        const { cfg } = this;
        const { blackboard } = tree;
        let varStr = "";
        for (const k in blackboard.values) {
            if (!(Blackboard.isTempVar(k) || Blackboard.isPrivateVar(k))) {
                varStr += `${k}:${blackboard.values[k]}, `;
            }
        }
        let depth = 0;
        if (tree.debug) {
            for (let node = this._parent; node; node = node._parent) {
                depth++;
            }
        }
        const indent = " ".repeat(depth);
        console.info(
            `[DEBUG] behavior3 -> ${indent}${this.name}: tree:${cfg.tree.name} tree_id:${tree.id}, ` +
                `node:${this.id}, status:${status}${extra}, values:{${varStr}} args:${JSON.stringify(
                    cfg.args,
                )}`,
        );
    }

    private static _evalCondition(tree: Tree<Context, unknown>, root: Node): boolean {
        const status = root.tick(tree);
        if (tree.__interrupted) {
            return false;
        } else if (status === "running") {
            root.error(`condition tree must not return 'running'`);
            root.abort(tree);
            return false;
        } else {
            return status === "success";
        }
    }

    /**
     * Executes the node's behavior tree logic.
     *
     * The node is re-entered from the root every tick. Use `tree.getState` and `tree.setState`
     * to keep the state between ticks when returning `running`.
     *
     * @param tree The behavior tree instance
     * @returns The execution status: `success`, `failure`, or `running`
     */
    abstract onTick(tree: Tree<Context, unknown>): Status;

    /**
     * Called when the running node is aborted, cleans up: stops moving, removes listeners and timers, etc.
     * The state of the node is cleared after this call.
     */
    onAbort(tree: Tree<Context, unknown>): void {}

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

        if (node.abort !== Node.prototype.abort) {
            throw new Error("don't override 'abort' function, override 'onAbort' instead");
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

        if (!descriptor.preemptive) {
            node.children.forEach((child) => {
                if (child.abortsLower) {
                    child.warn(`'lower' has no effect: parent '${node.name}' is not preemptive`);
                }
            });
        }

        return node;
    }
}
