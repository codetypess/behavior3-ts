// deno-lint-ignore-file no-explicit-any ban-types
import { Evaluator, ExpressionEvaluator } from "./evaluator";
import { Node, NodeData, NodeDef } from "./node";
import "./nodes";
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

export type DeepReadonly<T> = T extends object
    ? { readonly [P in keyof T]: DeepReadonly<T[P]> }
    : T;

type TimerEntry = {
    callback: Callback;
    tag: TagType;
    expired: number;
};

export abstract class Context {
    readonly nodeDefs: Record<string, DeepReadonly<NodeDef>> = {};
    readonly nodeCtors: Record<string, NodeContructor<Node>> = {};
    readonly trees: Record<string, Node> = {};

    protected _time: number = 0;

    private readonly _evaluators: Record<string, Evaluator> = {};
    private readonly _timers: TimerEntry[] = [];
    private readonly _listeners: Map<string, Map<EventTarget, Map<Callback, TagType>>> = new Map();

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
        return [];
    }

    /**
     * Schedules a callback to be executed after a specified delay, same callback will be replaced.
     *
     * @param time The delay in seconds before the callback is executed
     * @param callback The function to call after the delay
     * @param tag The tag used to identify which timers to remove
     */
    delay(time: number, callback: Callback, tag: TagType) {
        const expired = time + this._time;
        const timers = this._timers;

        let idx = timers.findIndex((v) => v.callback === callback);
        if (idx >= 0) {
            timers.splice(idx, 1);
        }

        idx = timers.findIndex((v) => v.expired > expired);
        if (idx >= 0) {
            timers.splice(idx, 0, { callback, tag, expired });
        } else {
            timers.push({ callback, tag, expired });
        }
    }

    update(dt: number): void {
        this._time += dt;

        const timers = this._timers;
        while (timers.length > 0) {
            if (timers[0].expired <= this._time) {
                const { callback } = timers.shift()!;
                callback();
            } else {
                break;
            }
        }
    }

    /**
     * Registers a listener for an event.
     *
     * @param event The event name to listen for
     * @param callback The function to call when the event occurs
     * @param tag The tag used to identify which listeners to remove
     */
    on(event: string, callback: Callback, tag: TagType): void;

    /**
     * Registers a listener for an event on a specific target.
     *
     * @param event The event name to listen for
     * @param target The target object to listen for the event on
     * @param callback The function to call when the event occurs
     * @param tag The tag used to identify which listeners to remove
     */
    on(event: string, target: EventTarget, callback: Callback, tag: TagType): void;

    on(
        event: string,
        callbackOrTarget: EventTarget | Callback,
        tagOrCallback: Callback,
        tag?: TagType
    ) {
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
        targetListeners.set(callback, tag);
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
        this._listeners.get(event)?.forEach((targetListeners, target, listeners) => {
            targetListeners.forEach((value, key) => {
                if (value === tag) {
                    targetListeners.delete(key);
                }
            });
            if (targetListeners.size === 0) {
                listeners.delete(target);
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
        this._listeners.forEach((listeners) => {
            listeners.forEach((targetListeners, target) => {
                targetListeners.forEach((value, key) => {
                    if (value === tag) {
                        targetListeners.delete(key);
                    }
                });
                if (targetListeners.size === 0) {
                    listeners.delete(target);
                }
            });
        });

        const timers = this._timers;
        for (let i = timers.length - 1; i >= 0; i--) {
            if (timers[i].tag === tag) {
                timers.splice(i, 1);
            }
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
            cfg.tree = treeCfg;
            cfg.input ||= [];
            cfg.output ||= [];
            cfg.children ||= [];
            cfg.args ||= {};
            cfg.children.forEach(traverse);
        };
        traverse(treeCfg.root);

        return Node.create(this, treeCfg.root);
    }
}
