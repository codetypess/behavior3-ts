import { Evaluator, ExpressionEvaluator } from "./evaluator";
import { Node, NodeData, NodeDef } from "./node";
import { PriorityQueue } from "./priority-queue";
import { filterNodeDescriptors } from "./register-node";
import { TreeData } from "./tree";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Constructor<T, A extends any[] = any[]> = new (...args: A) => T;
export type NodeContructor<T extends Node> = Constructor<T, ConstructorParameters<typeof Node>> & {
    descriptor: NodeDef;
};
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Callback<A extends any[] = any[]> = (...args: A) => unknown;
export type ObjectType = { [k: string]: unknown };
export type EventTarget = object | string | number;
export type TagType = unknown;

/** A registered listener, indexed by its tag. */
type Listener = {
    readonly event: string;
    readonly target: EventTarget;
    readonly callback: Callback;
    readonly tag: TagType;
};

/** A scheduled timer, indexed by its tag and its callback. */
type Timer = {
    readonly callback: Callback;
    readonly tag: TagType;
    readonly expired: number;
    /** The order of registration, the timers expiring at the same time run in this order. */
    readonly seq: number;
    /** Cancelled or fired: left in the heap until popped or compacted. */
    done: boolean;
};

type Subscription = Listener | Timer;

const isTimer = (sub: Subscription): sub is Timer => "seq" in sub;

/** The timers expiring first run first, those expiring at the same time in registration order. */
const compareTimers = (a: Timer, b: Timer) => a.expired - b.expired || a.seq - b.seq;

export abstract class Context {
    readonly nodeDefs: Record<string, NodeDef> = {};
    readonly nodeCtors: Record<string, NodeContructor<Node>> = {};
    readonly trees: Record<string, Node> = {};

    protected _time: number = 0;

    private readonly _evaluators: Record<string, Evaluator> = {};
    private readonly _timers = new PriorityQueue<Timer>(compareTimers);
    /** The pending timer of a callback, a callback has one timer. */
    private readonly _timerOf: Map<Callback, Timer> = new Map();
    /** The timers left in the heap after being cancelled, compacted when they are many. */
    private _cancelledTimers: number = 0;
    private _timerSeq: number = 0;
    private readonly _listeners: Map<string, Map<EventTarget, Map<Callback, Listener>>> = new Map();
    /** The listeners and the pending timers of every tag, `offAll` only visits its own. */
    private readonly _subscriptions: Map<TagType, Set<Subscription>> = new Map();

    constructor() {
        filterNodeDescriptors(this.supportGroupTypes).forEach((v) => {
            this.registerNode(v.ctor);
        });
    }

    abstract loadTree(path: string): Promise<Node>;

    get time() {
        return this._time;
    }

    get supportGroupTypes(): string[] {
        return ["Core"];
    }

    /**
     * Schedules a callback to be executed after a specified delay, same callback will be replaced.
     * The timers expiring at the same time run in the order they are scheduled.
     *
     * @param time The delay in seconds before the callback is executed
     * @param callback The function to call after the delay
     * @param tag The tag used to identify which timers to remove
     * @returns A function cancelling this timer only, calling it again or after the timer has
     * run or been replaced does nothing
     */
    delay(time: number, callback: Callback, tag: TagType): () => void {
        const old = this._timerOf.get(callback);
        if (old) {
            this._cancelTimer(old);
        }
        const timer: Timer = {
            callback,
            tag,
            expired: time + this._time,
            seq: this._timerSeq++,
            done: false,
        };
        this._timers.push(timer);
        this._timerOf.set(callback, timer);
        this._index(timer);
        return () => this._cancelTimer(timer);
    }

    update(dt: number): void {
        this._time += dt;

        const timers = this._timers;
        for (
            let timer = timers.peek();
            timer && timer.expired <= this._time;
            timer = timers.peek()
        ) {
            timers.pop();
            if (timer.done) {
                this._cancelledTimers--;
                continue;
            }
            this._finishTimer(timer);
            timer.callback();
        }
    }

    /**
     * Registers a listener for an event.
     *
     * @param event The event name to listen for
     * @param callback The function to call when the event occurs
     * @param tag The tag used to identify which listeners to remove
     * @returns A function removing this listener only, see the other overload
     */
    on(event: string, callback: Callback, tag: TagType): () => void;

    /**
     * Registers a listener for an event on a specific target.
     *
     * @param event The event name to listen for
     * @param target The target object to listen for the event on
     * @param callback The function to call when the event occurs
     * @param tag The tag used to identify which listeners to remove
     * @returns A function removing this listener only: `off` and `offAll` remove all the
     * listeners of a tag, like all the listeners of a tree. Calling it again does nothing. A
     * callback is registered once per event and target, registering it again replaces the
     * previous registration, whose function then does nothing.
     */
    on(event: string, target: EventTarget, callback: Callback, tag: TagType): () => void;

    on(
        event: string,
        callbackOrTarget: EventTarget | Callback,
        tagOrCallback: Callback,
        tag?: TagType,
    ): () => void {
        let target: EventTarget;
        let callback: Callback;
        if (typeof callbackOrTarget === "function") {
            callback = callbackOrTarget as Callback;
            tag = tagOrCallback;
            target = this as EventTarget;
        } else {
            target = callbackOrTarget as EventTarget;
            callback = tagOrCallback as Callback;
        }

        let listeners = this._listeners.get(event);
        if (!listeners) {
            listeners = new Map();
            this._listeners.set(event, listeners);
        }
        let targetListeners = listeners.get(target);
        if (!targetListeners) {
            targetListeners = new Map();
            listeners.set(target, targetListeners);
        }
        const old = targetListeners.get(callback);
        if (old) {
            this._unindex(old);
        }
        const listener: Listener = { event, target, callback, tag };
        targetListeners.set(callback, listener);
        this._index(listener);

        return () => this._removeListener(listener);
    }

    /**
     * Dispatches an event to all listeners registered for the specified event.
     * If a target is provided, only listeners registered for that target will be notified.
     * Otherwise, listeners registered for the context(default target) will be notified.
     *
     * @param event The event name to dispatch
     * @param target Optional target object that the event is associated with
     * @param args Additional arguments to pass to the event listeners
     */
    dispatch(event: string, target?: EventTarget | this, ...args: unknown[]) {
        this._listeners
            .get(event)
            ?.get(target ?? this)
            ?.forEach((_, callback) => {
                callback(...args);
            });
    }

    /**
     * Removes all listeners for the specified event that match the given tag.
     *
     * @param event The event name to remove listeners from
     * @param tag The tag used to identify which listeners to remove
     */
    off(event: string, tag: TagType) {
        this._subscriptions.get(tag)?.forEach((sub) => {
            if (!isTimer(sub) && sub.event === event) {
                this._removeListener(sub);
            }
        });
    }

    /**
     * Removes all listeners for the specified tag from the context.
     * This includes both event listeners and timers.
     *
     * @param tag The tag used to identify which listeners to remove
     */
    offAll(tag: TagType) {
        this._subscriptions.get(tag)?.forEach((sub) => {
            if (isTimer(sub)) {
                this._cancelTimer(sub);
            } else {
                this._removeListener(sub);
            }
        });
    }

    private _index(sub: Subscription) {
        let subs = this._subscriptions.get(sub.tag);
        if (!subs) {
            subs = new Set();
            this._subscriptions.set(sub.tag, subs);
        }
        subs.add(sub);
    }

    private _unindex(sub: Subscription) {
        const subs = this._subscriptions.get(sub.tag);
        if (subs?.delete(sub) && subs.size === 0) {
            this._subscriptions.delete(sub.tag);
        }
    }

    /** Removes the listener if it is still registered, not replaced or removed. */
    private _removeListener(listener: Listener) {
        const listeners = this._listeners.get(listener.event);
        const targetListeners = listeners?.get(listener.target);
        if (targetListeners?.get(listener.callback) !== listener) {
            return;
        }
        targetListeners.delete(listener.callback);
        if (targetListeners.size === 0) {
            listeners!.delete(listener.target);
        }
        this._unindex(listener);
    }

    /** The timer has run or is cancelled. */
    private _finishTimer(timer: Timer) {
        timer.done = true;
        if (this._timerOf.get(timer.callback) === timer) {
            this._timerOf.delete(timer.callback);
        }
        this._unindex(timer);
    }

    /** Cancels a pending timer, it stays in the heap until popped or compacted. */
    private _cancelTimer(timer: Timer) {
        if (timer.done) {
            return;
        }
        this._finishTimer(timer);
        this._cancelledTimers++;
        const timers = this._timers;
        if (this._cancelledTimers > 32 && this._cancelledTimers > timers.size >> 1) {
            timers.retain((v) => !v.done);
            this._cancelledTimers = 0;
        }
    }

    compileCode(code: string) {
        let evaluator = this._evaluators[code];
        if (!evaluator) {
            const expr = new ExpressionEvaluator(code);
            if (!expr.dryRun()) {
                throw new Error(`invalid expression: ${code}`);
            }
            evaluator = (envars: ObjectType) => expr.evaluate(envars);
            this._evaluators[code] = evaluator;
        }
        return evaluator;
    }

    registerCode(code: string, evaluator: Evaluator) {
        this._evaluators[code] = evaluator;
    }

    registerNode<T extends Node>(cls: NodeContructor<T>) {
        const descriptor = cls.descriptor;
        if (descriptor.doc) {
            let doc = descriptor.doc.replace(/^[\r\n]+/, "");
            const leadingSpace = doc.match(/^ */)?.[0];
            if (leadingSpace) {
                doc = doc
                    .substring(leadingSpace.length)
                    .replace(new RegExp(`[\r\n]${leadingSpace}`, "g"), "\n")
                    .replace(/ +$/, "");
            }
            descriptor.doc = doc;
        }
        this.nodeDefs[descriptor.name] = descriptor;
        this.nodeCtors[descriptor.name] = cls;
    }

    protected _createTree(treeCfg: TreeData) {
        let index = 0;
        const traverse = (cfg: NodeData) => {
            cfg.tree = treeCfg;
            cfg.index = index++;
            cfg.input ||= [];
            cfg.output ||= [];
            cfg.children ||= [];
            cfg.args ||= {};
            cfg.conditions?.forEach((v) => v.root && traverse(v.root));
            cfg.children.forEach(traverse);
        };
        traverse(treeCfg.root);

        const root = Node.create(this, treeCfg.root);
        if (root.abortsLower) {
            root.warn(`'lower' has no effect: root node has no parent`);
        }
        return root;
    }
}
