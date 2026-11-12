import { Blackboard } from "./blackboard";
import type { Context, NodeContructor, ObjectType } from "./context";
import type { Tree, TreeData } from "./tree";

/**
 * The status of a node.
 * + `success`: The node has completed its task successfully.
 * + `failure`: The node has failed to complete its task.
 * + `running`: The node is currently executing.
 * + `error`: The data is not trustworthy (an invalid id, an input of the wrong type, etc.), the
 *   node can't tell `success` from `failure`. Every parent returns `error` as well, only
 *   `ErrorToFailure` turns it into `failure`.
 *
 * A bug, such as a TypeError in the node code, is an exception rather than a status. The tree
 * dispatches `TreeEvent.EXCEPTION` and is interrupted.
 */
export type Status = "success" | "failure" | "running" | "error";

/**
 * Returned by a helper (like `_checkOneof`) which can't return the status for the node,
 * the node should return `error` then.
 */
export const ERROR: unique symbol = Symbol("error");

/**
 * Set to an output to leave the variable untouched, the framework doesn't write it back.
 */
export const SKIP: unique symbol = Symbol("skip");

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
     * A Context only registers the nodes of the groups it supports (`supportGroupTypes`),
     * and Behavior3 Editor checks a tree's groups against it. Builtin nodes are in `Core`.
     */
    group: GroupType[];
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
     * `lower`/`both` conditions of the children above the running child (preemption).
     *
     * A node declaring this must call `_checkPreempt` in `onTick`.
     */
    preemptive?: boolean;
    /**
     * Whether the node defers its work to the runtime, which can't be checked when the tree is
     * loaded:
     * + it registers a callback (a listener, a timer) which runs later, after the node has
     *   returned, like `Listen` and `Delay`. The callback belongs to the tree, it is not undone
     *   when the branch is aborted or interrupted, only by `tree.clear()`;
     * + or it runs a tree loaded at runtime, like `RunTree`, whose nodes are not checked with
     *   this tree.
     *
     * Not a node returning `running` to wait (like `Wait`), whose state is managed by the tree.
     *
     * A deferred node is not allowed in a condition tree, checked when the tree is loaded: a
     * condition tree may be evaluated again and again, every evaluation would register one more
     * callback, and a tree run by path may contain such nodes. To reuse a condition, use a
     * subtree in the editor, which is inlined into the tree.
     */
    deferred?: boolean;
}

/**
 * When the conditions of a node are checked after entering it:
 * + `none`: only checked when entering the node.
 * + `self`: also checked every tick while the node is running, aborts the node if false.
 * + `lower`: also checked by the preemptive parent while a lower priority sibling (below it) is running,
 *   aborts the sibling and runs this node if true.
 * + `both`: `self` and `lower`.
 */
export type AbortMode = "none" | "self" | "lower" | "both";

export interface ConditionData {
    /** Default `none`. */
    abort?: AbortMode;
    /** The condition tree, `success` is true, `failure` and `error` are false, `running` is not allowed. */
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
}

export interface Condition {
    readonly abort: AbortMode;
    readonly root: Node;
}

const ABORT_MODES: readonly AbortMode[] = ["none", "self", "lower", "both"];

/** The tree being created by `Node.__createRoot`, its nodes take their tree and index from it. */
let creating: { tree: TreeData; index: number } | undefined;

/**
 * The input and output of a call of `onTick`, a stack of them shared by all the trees: the
 * execution is synchronous, a call re-entering a node (another tree of the path, a callback of
 * the same tree) just takes the next frame. The frames are reused, only valid during the call.
 */
type Frame = { readonly input: unknown[]; readonly output: unknown[] };
const frames: Frame[] = [];
let sp = 0;

const deepFreeze = <T>(value: T): T => {
    if (value && typeof value === "object" && !Object.isFrozen(value)) {
        Object.freeze(value);
        Object.values(value).forEach(deepFreeze);
    }
    return value;
};

export abstract class Node {
    /** The config of the node, shared by all the trees and deep frozen, see `_ownArg`. */
    readonly args: unknown = {};
    /** The index of the node in the tree, used to store the state of the node. */
    readonly index: number;

    protected readonly _context: Context;

    private _parent: Node | null = null;
    private _children: Node[] = [];
    private _cfg: NodeData;
    private _treeName: string;
    /** The json of the object args, parsed again by `_ownArg`. */
    private _argJson: Record<string, string> | undefined;
    private _conditions: Condition[] = [];
    private _selfConditions: Condition[] = [];
    private _preemptors: number[] | undefined;

    constructor(context: Context, cfg: NodeData) {
        this._context = context;
        this._cfg = cfg;
        if (!creating) {
            throw new Error(`behavior3: node '${cfg.name}' is created outside of a tree`);
        }
        this._treeName = creating.tree.name;
        this.index = creating.index++;

        const descriptor = context.nodeDefs[cfg.name] as NodeDef | undefined;
        Object.keys(cfg.args).forEach((k) => {
            const value = cfg.args[k];
            if (value && typeof value === "object") {
                // readonly config: shared by all trees, `_ownArg` gives a copy to hand out
                const json = JSON.stringify(value);
                this._argJson = this._argJson ?? {};
                this._argJson[k] = json;
                (this.args as ObjectType)[k] = deepFreeze(JSON.parse(json));
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
            Node._checkConditionTree(context, condition.root);
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

    /** `tree->name#id`, the prefix of the messages of the node. */
    private get _location() {
        return `${this._treeName}->${this.name}#${this.id}`;
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
     * @private Whether the node is a `Scope`: its children run in its overlay, and as the root of
     * a condition tree it replaces the implicit scope of the condition.
     */
    get __isScope(): boolean {
        return false;
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
     * Only called by the parent node or the framework, use `tree.tick()` outside. An exception
     * thrown here is unwound by `tree.tick()` or the callback, a direct call just gets `failure`.
     *
     * @param tree The behavior tree instance
     * @param conditionsChecked Skips the entry check, used by the preemptive parent which has
     * just evaluated the conditions of the node.
     */
    tick(tree: Tree<Context, unknown>, conditionsChecked: boolean = false): Status {
        // no try/finally on the hot path: `_tick` catches the exceptions of `onTick`, another
        // exception leaves `sp` above, set back by the call below when it returns, or by the
        // entry (`tree.tick`, a callback) when it exits
        const base = sp;
        const frame = frames[base] ?? (frames[base] = { input: [], output: [] });
        sp = base + 1;
        const status = this._tick(tree, conditionsChecked, frame);
        sp = base;
        return status;
    }

    private _tick(tree: Tree<Context, unknown>, conditionsChecked: boolean, frame: Frame): Status {
        const { blackboard } = tree;
        const cfg = this._cfg;
        const { input, output } = frame;

        if (tree.__stopScope.stopped) {
            // unwinding the interrupted tick, don't execute any more node
            return "running";
        } else if (tree.debug) {
            tree.__markTicked(this);
        }

        if (this._conditions.length > 0) {
            let passed: boolean;
            if (tree.isRunning(this)) {
                passed = this.evalSelfConditions(tree);
                if (!passed && !tree.__stopScope.stopped) {
                    this.abort(tree);
                }
            } else {
                passed = conditionsChecked || this.evalConditions(tree);
            }
            if (tree.__stopScope.stopped) {
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

        tree.__runningNode = this;

        let status: Status = "failure";
        try {
            status = this.onTick(tree, input, output);
        } catch (e) {
            const error = e instanceof Error ? e : new Error(String(e));
            const msg = error.stack ?? error.message;
            if (error.message.startsWith(`${this._location}: `)) {
                // thrown by `node.throw`, the message already has the location of the node
                console.error(msg);
            } else {
                this.error(msg);
            }
            tree.__exception(this, error);
        }

        // Register a running result before checking stop: onTick may have started resources
        // before a synchronous interrupt or clear, and they still need onAbort when we exit.
        if (status === "running" && !tree.isRunning(this)) {
            tree.__markRunning(this);
        }

        if (tree.__stopScope.stopped) {
            return "running";
        } else if (status !== "running") {
            if (status !== "error") {
                // the result of an error is not trustworthy, don't write it back
                const outputKeys = cfg.output;
                for (let i = 0; i < outputKeys.length; i++) {
                    const value = output[i];
                    if (value !== SKIP) {
                        blackboard.set(outputKeys[i], value);
                    }
                }
            }
            // a finished node must not leave running children behind
            const children = this._children;
            for (let i = 0; i < children.length; i++) {
                children[i].abort(tree);
            }
            tree.__clearState(this);
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
        // the children of a Scope are aborted in its overlay, which is its state while running
        const scope = this.__isScope ? tree.getState<Blackboard>(this) : undefined;
        const outer = scope ? tree.__swapScope(scope) : undefined;
        try {
            for (const child of this._children) {
                child.abort(tree);
            }
        } finally {
            if (outer) {
                tree.__swapScope(outer);
            }
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
        throw new Error(`${this._location}: ${msg}`);
    }

    /**
     * use console.error to print error message
     */
    error(msg: string) {
        console.error(`${this._location}: ${msg}`);
    }

    /**
     * use console.warn to print warning message
     */
    warn(msg: string) {
        console.warn(`${this._location}: ${msg}`);
    }

    /**
     * use console.debug to print debug message
     */
    debug(msg: string) {
        console.debug(`${this._location}: ${msg}`);
    }

    /**
     * use console.info to print info message
     */

    info(msg: string) {
        console.info(`${this._location}: ${msg}`);
    }

    /**
     * use console.log to print log message
     */
    log(msg: string) {
        console.log(`${this._location}: ${msg}`);
    }

    /**
     * Gets the value from the input if it is configured, otherwise from the arg.
     *
     * A missing input falls back to `defaultValue` with a warning, or returns `ERROR` without
     * `defaultValue`, the node should return `error` then.
     *
     * @param input The input of `onTick`
     */
    protected _checkOneof<V>(
        input: readonly unknown[],
        inputIndex: number,
        argValue: V | undefined,
    ): V | typeof ERROR;
    protected _checkOneof<V>(
        input: readonly unknown[],
        inputIndex: number,
        argValue: V | undefined,
        defaultValue: V,
    ): V;
    protected _checkOneof<V>(
        input: readonly unknown[],
        inputIndex: number,
        argValue: V | undefined,
        defaultValue?: V,
    ) {
        const inputValue = input[inputIndex];
        const inputName = this.cfg.input[inputIndex];
        let value: V | undefined;
        if (inputName) {
            if (inputValue === undefined) {
                this.warn(`missing input '${inputName}'`);
                if (defaultValue === undefined) {
                    return ERROR;
                }
            }
            value = inputValue as V;
        } else {
            value = argValue;
        }
        return (value ?? defaultValue) as V;
    }

    /**
     * A fresh mutable copy of the arg, to hand it out (to the blackboard, to an object of the
     * host) or to change it: the args are deep frozen and shared by all the trees. A primitive
     * is returned as is, `undefined` if the arg is not configured.
     */
    protected _ownArg<V = unknown>(name: string): V | undefined {
        const json = this._argJson?.[name];
        return (json !== undefined ? JSON.parse(json) : (this.args as ObjectType)[name]) as V;
    }

    /**
     * Checks whether a child above the running child can preempt it, only available
     * for the node declared `preemptive` in its descriptor.
     *
     * Checks the children with `lower`/`both` conditions from top to bottom, evaluating all
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
            `[DEBUG] behavior3 -> ${indent}${this.name}: tree:${this._treeName} tree_id:${tree.id}, ` +
                `node:${this.id}, status:${status}${extra}, values:{${varStr}} args:${JSON.stringify(
                    cfg.args,
                )}`,
        );
    }

    /** @private The depth of the frame stack, saved by an entry and restored when it exits. */
    static get __frameDepth() {
        return sp;
    }

    static set __frameDepth(depth: number) {
        sp = depth;
    }

    /**
     * A condition is only true or false, `error` (untrustworthy data) is false.
     *
     * The condition tree runs in an implicit scope which is dropped after the evaluation, unless
     * its root is a `Scope`: the `Scope` replaces it and exports its output when it succeeds.
     */
    private static _evalCondition(tree: Tree<Context, unknown>, root: Node): boolean {
        let status: Status;
        if (root.__isScope) {
            status = Node._tickCondition(tree, root);
        } else {
            const outer = tree.__swapScope(tree.blackboard.fork());
            try {
                status = Node._tickCondition(tree, root);
            } finally {
                tree.__swapScope(outer);
            }
        }
        return !tree.__stopScope.stopped && status === "success";
    }

    /**
     * Ticks the condition tree, a running condition tree is aborted in its scope. When interrupted,
     * the running nodes are aborted now: the implicit scope is dropped after the evaluation, the
     * interrupt would abort them in the outer scope.
     */
    private static _tickCondition(tree: Tree<Context, unknown>, root: Node): Status {
        const status = root.tick(tree);
        if (tree.__stopScope.stopped) {
            tree.__abortAll(root);
        } else if (status === "running") {
            root.error(`condition tree must not return 'running'`);
            root.abort(tree);
        }
        return status;
    }

    /**
     * Executes the node's behavior tree logic.
     *
     * The node is re-entered from the root every tick. Use `tree.getState` and `tree.setState`
     * to keep the state between ticks when returning `running`.
     *
     * `input` and `output` are only valid during this call, they are reused by the next calls:
     * don't keep them in a closure or a field. Narrow their types in the override, like
     * `[count]: readonly [number]`.
     *
     * @param tree The behavior tree instance
     * @param input The values of `cfg.input`, read from the current scope before the call
     * @param output Filled by the node, written to `cfg.output` in the current scope when the
     * node returns `success` or `failure`, `SKIP` leaves the variable untouched
     * @returns The execution status: `success`, `failure`, `running` or `error`, returns `error`
     * when a child returns `error`
     */
    abstract onTick(tree: Tree<Context, unknown>, input: readonly unknown[], output: unknown[]): Status;

    /**
     * Called when the running node is aborted, cleans up: stops moving, removes listeners and timers, etc.
     * The state of the node is cleared after this call.
     */
    onAbort(tree: Tree<Context, unknown>): void {}

    /**
     * Called when the tree is cleared, releases what the node keeps for the tree beyond a run,
     * like the subtree instances or the caches in private vars. The running nodes have been
     * aborted before this call, and the blackboard is cleared after it.
     */
    onClear(tree: Tree<Context, unknown>): void {}

    static get descriptor(): NodeDef {
        throw new Error(`descriptor not found in '${this.name}'`);
    }

    /**
     * Throws if a node of the condition tree is `deferred`. The condition trees of
     * the nodes inside are checked when those nodes are created.
     */
    private static _checkConditionTree(context: Context, node: Node) {
        const descriptor = context.nodeDefs[node.name] as NodeDef | undefined;
        if (descriptor?.deferred) {
            node.throw(`'${node.name}' is deferred, not allowed in a condition tree`);
        }
        for (const child of node._children) {
            Node._checkConditionTree(context, child);
        }
    }

    /**
     * @private Creates the nodes of the tree, they are indexed in pre-order (the node, its
     * conditions, its children), disabled nodes are not created and not indexed.
     */
    static __createRoot(context: Context, treeCfg: TreeData) {
        const last = creating;
        creating = { tree: treeCfg, index: 0 };
        try {
            return Node.create(context, treeCfg.root);
        } finally {
            creating = last;
        }
    }

    static create(context: Context, cfg: NodeData) {
        const NodeCls = context.nodeCtors[cfg.name] as NodeContructor<Node> | undefined;
        const descriptor = context.nodeDefs[cfg.name] as NodeDef | undefined;

        if (!NodeCls || !descriptor) {
            const treeName = creating?.tree.name ?? "?";
            throw new Error(`behavior3: node '${treeName}->${cfg.name}' is not registered`);
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
