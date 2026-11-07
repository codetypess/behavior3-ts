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

/**
 * A registered listener, indexed by its tag. Once removed or replaced, its target, callback and
 * tag are released: a cancel function kept by the caller doesn't keep them alive.
 */
type Listener = {
    readonly event: string;
    target: EventTarget | undefined;
    callback: Callback | undefined;
    tag: TagType;
    /** The order of registration, a listener registered during a dispatch is not called by it. */
    readonly seq: number;
};

/**
 * A scheduled timer, indexed by its tag and its callback. Once run or cancelled, its callback and
 * tag are released: it may stay in the heap until popped or compacted.
 */
type Timer = {
    callback: Callback | undefined;
    tag: TagType;
    readonly expired: number;
    /**
     * The order of scheduling, the timers expiring at the same time run in this order. A timer
     * scheduled during an `update` doesn't run in it.
     */
    readonly seq: number;
    /** Cancelled or fired: left in the heap until popped or compacted. */
    done: boolean;
};

type Subscription = Listener | Timer;

const isTimer = (sub: Subscription): sub is Timer => "expired" in sub;

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
    private _listenerSeq: number = 0;
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
     * The timers expiring at the same time run in the order they are scheduled. A timer scheduled
     * while the timers are running (in a timer callback) runs in the next `update` at the earliest,
     * even with a delay of 0.
     *
     * @param time The delay in seconds before the callback is executed, a negative delay is 0
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
            // not negative: a timer expiring before the ones of this `update` would stop it early
            expired: Math.max(time, 0) + this._time,
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

        // the timers scheduled from now on wait for the next update: a callback scheduling itself
        // with a delay of 0 doesn't loop forever. Such a timer on top means no expired timer
        // scheduled before is left, they come first (expired earlier, or at the same time with a
        // lower seq)
        const limit = this._timerSeq;
        const timers = this._timers;
        for (let timer = timers.peek(); timer; timer = timers.peek()) {
            if (timer.done) {
                // a cancelled timer is dropped once on top, expired or not
                timers.pop();
                this._cancelledTimers--;
            } else if (timer.expired <= this._time && timer.seq < limit) {
                timers.pop();
                const callback = timer.callback!;
                this._finishTimer(timer);
                callback();
            } else {
                break;
            }
        }
        this._compactTimers();
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
     * previous registration, whose function then does nothing, but keeps its place. A listener
     * registered during a dispatch of the event is called from the next dispatch on.
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
            Context._releaseListener(old);
        }
        // a replaced listener keeps its place: called by a dispatch started before, like before
        const seq = old ? old.seq : this._listenerSeq++;
        const listener: Listener = { event, target, callback, tag, seq };
        targetListeners.set(callback, listener);
        this._index(listener);

        return () => this._removeListener(listener);
    }

    /**
     * Dispatches an event to all listeners registered for the specified event.
     * If a target is provided, only listeners registered for that target will be notified.
     * Otherwise, listeners registered for the context(default target) will be notified.
     *
     * The listeners are the ones registered when the dispatch starts: a listener registered by a
     * listener is not called by this dispatch (a removed then registered again one neither), a
     * removed one is not called either, a replaced one is called once.
     * An exception thrown by a listener goes to the caller, the other listeners are skipped.
     *
     * @param event The event name to dispatch
     * @param target Optional target object that the event is associated with
     * @param args Additional arguments to pass to the event listeners
     */
    dispatch(event: string, target?: EventTarget | this, ...args: unknown[]) {
        const listeners = this._listeners.get(event)?.get(target ?? this);
        if (listeners) {
            const limit = this._listenerSeq;
            listeners.forEach((listener, callback) => {
                if (listener.seq < limit) {
                    callback(...args);
                }
            });
        }
    }

    /**
     * @private Dispatches an event of the lifecycle of a tree, like `dispatch`, but an exception
     * thrown by a listener is logged: the other listeners are still called, and the tree goes on
     * (like an exception thrown by `onAbort` or `onClear`).
     *
     * @param path The path of the tree, shown in the log
     */
    __dispatchIsolated(path: string, event: string, target: EventTarget, ...args: unknown[]) {
        const listeners = this._listeners.get(event)?.get(target);
        if (listeners) {
            const limit = this._listenerSeq;
            listeners.forEach((listener, callback) => {
                if (listener.seq < limit) {
                    try {
                        callback(...args);
                    } catch (e) {
                        const error = e instanceof Error ? e : new Error(String(e));
                        console.error(
                            `behavior3: a listener of '${event}' of tree '${path}' threw: ` +
                                `${error.stack ?? error.message}`,
                        );
                    }
                }
            });
        }
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
        const { target, callback } = listener;
        if (callback === undefined) {
            // removed or replaced, released
            return;
        }
        const listeners = this._listeners.get(listener.event);
        const targetListeners = listeners?.get(target!);
        if (targetListeners?.get(callback) !== listener) {
            return;
        }
        targetListeners.delete(callback);
        if (targetListeners.size === 0) {
            listeners!.delete(target!);
        }
        this._unindex(listener);
        Context._releaseListener(listener);
    }

    private static _releaseListener(listener: Listener) {
        listener.target = undefined;
        listener.callback = undefined;
        listener.tag = undefined;
    }

    /** The timer has run or is cancelled, its callback and tag are released. */
    private _finishTimer(timer: Timer) {
        timer.done = true;
        if (this._timerOf.get(timer.callback!) === timer) {
            this._timerOf.delete(timer.callback!);
        }
        this._unindex(timer);
        timer.callback = undefined;
        timer.tag = undefined;
    }

    /** Cancels a pending timer, it stays in the heap until popped or compacted. */
    private _cancelTimer(timer: Timer) {
        if (timer.done) {
            return;
        }
        this._finishTimer(timer);
        this._cancelledTimers++;
        this._compactTimers();
    }

    /** Removes the cancelled timers from the heap when they are more than half of it. */
    private _compactTimers() {
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
        const traverse = (cfg: NodeData) => {
            cfg.input ||= [];
            cfg.output ||= [];
            cfg.children ||= [];
            cfg.args ||= {};
            cfg.conditions?.forEach((v) => v.root && traverse(v.root));
            cfg.children.forEach(traverse);
        };
        traverse(treeCfg.root);

        const root = Node.__createRoot(this, treeCfg);
        if (root.abortsLower) {
            root.warn(`'lower' has no effect: root node has no parent`);
        }
        return root;
    }
}
