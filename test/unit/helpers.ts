import {
    AbortMode,
    Context,
    Node,
    NodeData,
    NodeDef,
    Status,
    Tree,
    TreeData,
} from "../../src/behavior3";

export type NodeSpec = {
    name: string;
    id: string;
    args?: Record<string, unknown>;
    input?: string[];
    output?: string[];
    disabled?: boolean;
    children?: NodeSpec[];
    conditions?: { abort?: AbortMode; root: NodeSpec }[];
};

type Options = Omit<NodeSpec, "name" | "id">;

/** Builds a node, `id` is also used as the label in the log of `Probe`. */
export const n = (name: string, id: string, opts: Options = {}): NodeSpec => ({ name, id, ...opts });

/** A condition item. */
export const cond = (root: NodeSpec, abort?: AbortMode) => ({ abort, root });

/**
 * A leaf node logging `tick:<id>` and `abort:<id>`.
 * Returns the status in blackboard key `<id>`, or `args.status`, or `success`.
 */
export const probe = (id: string, opts: Options = {}) => n("Probe", id, opts);

export class Probe extends Node {
    declare args: { readonly status?: Status };

    override onTick(tree: Tree<TestContext, unknown>): Status {
        tree.context.log.push(`tick:${this.id}`);
        return tree.blackboard.get<Status>(this.id) ?? this.args.status ?? "success";
    }

    override onAbort(tree: Tree<TestContext, unknown>): void {
        tree.context.log.push(`abort:${this.id}`);
    }

    static override get descriptor(): NodeDef {
        return { name: "Probe", type: "Action", desc: "test probe", args: [] };
    }
}

/** A decorator ignoring the running child, the framework must abort it. */
export class Leaky extends Node {
    override onTick(tree: Tree<TestContext, unknown>): Status {
        this.children[0].tick(tree);
        return "success";
    }

    override onAbort(tree: Tree<TestContext, unknown>): void {
        tree.context.log.push(`abort:${this.id}`);
    }

    static override get descriptor(): NodeDef {
        return { name: "Leaky", type: "Decorator", desc: "ignore running child", children: 1 };
    }
}

/** A composite like Sequence, logging its abort. */
export class Group extends Node {
    override onTick(tree: Tree<TestContext, unknown>): Status {
        let i = tree.getState<number>(this) ?? 0;
        for (; i < this.children.length; i++) {
            const status = this.children[i].tick(tree);
            if (status === "running") {
                tree.setState(this, i);
                return "running";
            } else if (status !== "success") {
                return status;
            }
        }
        return "success";
    }

    override onAbort(tree: Tree<TestContext, unknown>): void {
        tree.context.log.push(`abort:${this.id}`);
    }

    static override get descriptor(): NodeDef {
        return { name: "Group", type: "Composite", desc: "sequence with abort log", children: -1 };
    }
}

/** Throws in onTick. */
export class Throw extends Node {
    override onTick(): Status {
        throw new Error("boom");
    }

    static override get descriptor(): NodeDef {
        return { name: "Throw", type: "Action", desc: "throw an error" };
    }
}

/** Interrupts the tree in onTick. */
export class Interrupt extends Node {
    override onTick(tree: Tree<TestContext, unknown>): Status {
        tree.interrupt();
        return "success";
    }

    static override get descriptor(): NodeDef {
        return { name: "Interrupt", type: "Action", desc: "interrupt the tree" };
    }
}

/** Dispatches `args.event` synchronously in onTick. */
export class Emit extends Node {
    declare args: { readonly event: string };

    override onTick(tree: Tree<TestContext, unknown>): Status {
        tree.context.dispatch(this.args.event);
        return "success";
    }

    static override get descriptor(): NodeDef {
        return { name: "Emit", type: "Action", desc: "dispatch an event", args: [] };
    }
}

/** Records the args it receives, then mutates them. */
export class ArgsSpy extends Node {
    declare args: { value?: { list: number[] }; list?: readonly number[] };

    override onTick(tree: Tree<TestContext, unknown>): Status {
        if (this.args.value) {
            tree.context.received.push(this.args.value);
            this.args.value.list.push(this.args.value.list.length);
        }
        if (this.args.list) {
            (this.args.list as number[]).push(0);
        }
        return "success";
    }

    static override get descriptor(): NodeDef {
        return {
            name: "ArgsSpy",
            type: "Action",
            desc: "record args",
            args: [
                { name: "value", type: "json?", desc: "json" },
                { name: "list", type: "int[]?", desc: "readonly" },
            ],
        };
    }
}

/** A Selector-like composite declaring `preemptive` and using `_checkPreempt`. */
export class PrioritySelector extends Node {
    override onTick(tree: Tree<TestContext, unknown>): Status {
        let i = tree.getState<number>(this);
        let checked = false;
        if (i === undefined) {
            i = 0;
        } else {
            const k = this._checkPreempt(tree, i);
            if (k !== i) {
                this.children[i].abort(tree);
                i = k;
                checked = true;
            }
        }
        for (; i < this.children.length; i++) {
            const status = this.children[i].tick(tree, checked);
            checked = false;
            if (status === "running") {
                tree.setState(this, i);
                return "running";
            } else if (status === "success") {
                return "success";
            }
        }
        return "failure";
    }

    static override get descriptor(): NodeDef {
        return {
            name: "PrioritySelector",
            type: "Composite",
            desc: "custom preemptive composite",
            children: -1,
            preemptive: true,
        };
    }
}

let pathId = 0;

export class TestContext extends Context {
    /** `tick:<id>` and `abort:<id>` written by test nodes. */
    log: string[] = [];
    received: unknown[] = [];

    private _sources: Map<string, NodeSpec> = new Map();

    constructor() {
        super();
        this.registerNode(Probe);
        this.registerNode(Leaky);
        this.registerNode(Group);
        this.registerNode(Throw);
        this.registerNode(Interrupt);
        this.registerNode(Emit);
        this.registerNode(ArgsSpy);
        this.registerNode(PrioritySelector);
    }

    override loadTree(path: string): Promise<Node> {
        let root = this.trees[path];
        if (!root) {
            const data = {
                name: path,
                desc: "",
                group: [],
                root: structuredClone(this._sources.get(path)) as unknown as NodeData,
            } satisfies TreeData;
            root = this._createTree(data);
            this.trees[path] = root;
        }
        return Promise.resolve(root);
    }

    createTree(root: NodeSpec): Tree<TestContext, unknown> {
        const path = `test-tree-${++pathId}`;
        this._sources.set(path, root);
        return new Tree(this, {}, path);
    }

    /** Returns the log and clears it. */
    takeLog() {
        const log = this.log;
        this.log = [];
        return log;
    }

    listenerCount(event: string) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const listeners = (this as any)._listeners.get(event) as Map<unknown, Map<unknown, unknown>>;
        let count = 0;
        listeners?.forEach((v) => (count += v.size));
        return count;
    }
}

/** Runs `fn` with console output captured. */
export const captureConsole = <T>(fn: () => T) => {
    const warn: string[] = [];
    const error: string[] = [];
    const info: string[] = [];
    const log: string[] = [];
    const debug: string[] = [];
    const old = { ...console };
    const join = (args: unknown[]) => args.map(String).join(" ");
    console.warn = (...args: unknown[]) => warn.push(join(args));
    console.error = (...args: unknown[]) => error.push(join(args));
    console.info = (...args: unknown[]) => info.push(join(args));
    console.log = (...args: unknown[]) => log.push(join(args));
    console.debug = (...args: unknown[]) => debug.push(join(args));
    try {
        return { result: fn(), warn, error, info, log, debug };
    } finally {
        console.warn = old.warn;
        console.error = old.error;
        console.info = old.info;
        console.log = old.log;
        console.debug = old.debug;
    }
};
