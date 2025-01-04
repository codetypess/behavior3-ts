import { Evaluator, ExpressionEvaluator } from "./evaluator";
import { Node, NodeData, NodeDef } from "./node";
import { Index } from "./nodes/actions";
import { Calculate } from "./nodes/actions/calculate";
import { Concat } from "./nodes/actions/concat";
import { GetField } from "./nodes/actions/get-field";
import { Let } from "./nodes/actions/let";
import { Log } from "./nodes/actions/log";
import { Now } from "./nodes/actions/now";
import { Push } from "./nodes/actions/push";
import { Random } from "./nodes/actions/random";
import { RandomIndex } from "./nodes/actions/random-index";
import { SetField } from "./nodes/actions/set-field";
import { Wait } from "./nodes/actions/wait";
import { IfElse } from "./nodes/composites/ifelse";
import { Parallel } from "./nodes/composites/parallel";
import { Race } from "./nodes/composites/race";
import { Selector } from "./nodes/composites/selector";
import { Sequence } from "./nodes/composites/sequence";
import { Case, Switch } from "./nodes/composites/switch";
import { Check } from "./nodes/conditions/check";
import { Includes } from "./nodes/conditions/includes";
import { IsNull } from "./nodes/conditions/is-null";
import { NotNull } from "./nodes/conditions/not-null";
import { AlwaysFailure } from "./nodes/decorators/always-failure";
import { AlwaysRunning } from "./nodes/decorators/always-running";
import { AlwaysSuccess } from "./nodes/decorators/always-success";
import { Assert } from "./nodes/decorators/assert";
import { Delay } from "./nodes/decorators/delay";
import { Filter } from "./nodes/decorators/filter";
import { Foreach } from "./nodes/decorators/foreach";
import { Invert } from "./nodes/decorators/invert";
import { Listen } from "./nodes/decorators/listen";
import { Once } from "./nodes/decorators/once";
import { Repeat } from "./nodes/decorators/repeat";
import { RepeatUntilFailure } from "./nodes/decorators/repeat-until-failure";
import { RepeatUntilSuccess } from "./nodes/decorators/repeat-until-success";
import { Timeout } from "./nodes/decorators/timeout";
import { TreeData } from "./tree";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Constructor<T, A extends any[] = any[]> = new (...args: A) => T;
export type Callback<A extends unknown[] = unknown[]> = (...args: A) => void;
export type ObjectType = { [k: string]: unknown };
export type TargetType = object | string | number;
export type TagType = unknown;

// prettier-ignore
export type DeepReadonly<T> =
    T extends (infer U)[] ? ReadonlyArray<DeepReadonly<U>> :
    // eslint-disable-next-line @typescript-eslint/ban-types
    T extends Function ? T :
    T extends object ? { readonly [K in keyof T]: DeepReadonly<T[K]> } :
    T;

export class Context {
    readonly nodeDefs: Record<string, DeepReadonly<NodeDef>> = {};
    readonly trees: Record<string, Node> = {};

    protected _evaluators: Record<string, Evaluator> = {};
    protected _time: number = 0;
    protected _delays: Map<Callback, [TagType, number]> = new Map();
    protected _listenerMap: Map<string, Map<TargetType, Map<Callback, TagType>>> = new Map();

    private _nodeClasses: Record<string, Constructor<Node>> = {};

    constructor() {
        this.registerNode(AlwaysFailure);
        this.registerNode(AlwaysRunning);
        this.registerNode(AlwaysSuccess);
        this.registerNode(Assert);
        this.registerNode(Calculate);
        this.registerNode(Case);
        this.registerNode(Check);
        this.registerNode(Concat);
        this.registerNode(Delay);
        this.registerNode(Filter);
        this.registerNode(Foreach);
        this.registerNode(GetField);
        this.registerNode(IfElse);
        this.registerNode(Includes);
        this.registerNode(Index);
        this.registerNode(Invert);
        this.registerNode(IsNull);
        this.registerNode(Let);
        this.registerNode(Listen);
        this.registerNode(Log);
        this.registerNode(NotNull);
        this.registerNode(Now);
        this.registerNode(Once);
        this.registerNode(Parallel);
        this.registerNode(Push);
        this.registerNode(Race);
        this.registerNode(Random);
        this.registerNode(RandomIndex);
        this.registerNode(Repeat);
        this.registerNode(RepeatUntilFailure);
        this.registerNode(RepeatUntilSuccess);
        this.registerNode(Selector);
        this.registerNode(Sequence);
        this.registerNode(SetField);
        this.registerNode(Switch);
        this.registerNode(Timeout);
        this.registerNode(Wait);
    }

    loadTree(path: string): Promise<Node> {
        throw new Error("Method not implemented.");
    }

    get time() {
        return this._time;
    }

    delay(time: number, callback: Callback, tag: TagType) {
        const expired = time + this._time;
        this._delays.set(callback, [tag, expired]);
    }

    update(dt: number): void {
        this._time += dt;
        this._delays.forEach(([_, expired], callback) => {
            if (expired <= this._time) {
                this._delays.delete(callback);
                callback();
            }
        });
    }

    on(event: string, callback: Callback, tag: TagType): void;

    on(event: string, target: TargetType, callback: Callback, tag: TagType): void;

    on(
        event: string,
        callbackOrTarget: TargetType | Callback,
        tagOrCallback: Callback,
        tag?: TagType
    ) {
        let target: TargetType;
        let callback: Callback;
        if (typeof callbackOrTarget === "function") {
            callback = callbackOrTarget as Callback;
            tag = tagOrCallback as object;
            target = this as TargetType;
        } else {
            target = callbackOrTarget as TargetType;
            callback = tagOrCallback as Callback;
        }

        let listenerMap = this._listenerMap.get(event);
        if (!listenerMap) {
            listenerMap = new Map();
            this._listenerMap.set(event, listenerMap);
        }
        let targetListeners = listenerMap.get(target);
        if (!targetListeners) {
            targetListeners = new Map();
            listenerMap.set(target, targetListeners);
        }
        targetListeners.set(callback, tag!);
    }

    dispatch(event: string, target?: TargetType | this, ...args: unknown[]) {
        this._listenerMap
            .get(event)
            ?.get(target ?? this)
            ?.forEach((_, callback) => {
                callback(...args);
            });
    }

    off(event: string, tag: TagType) {
        this._listenerMap.get(event)?.forEach((targetListeners, target, listeners) => {
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

    offAll(tag: TagType) {
        this._listenerMap.forEach((listeners) => {
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

        this._delays.forEach(([value], callback) => {
            if (value === tag) {
                this._delays.delete(callback);
            }
        });
    }

    compileCode(code: string) {
        let evaluator = this._evaluators[code];
        if (!evaluator) {
            const expr = new ExpressionEvaluator(code);
            evaluator = (envars: ObjectType) => expr.evaluate(envars);
            this._evaluators[code] = evaluator;
        }
        return evaluator;
    }

    registerCode(code: string, evaluator: Evaluator) {
        this._evaluators[code] = evaluator;
    }

    registerNode<T extends Node>(cls: Constructor<T>) {
        const node = new cls();
        const descriptor = node.descriptor;
        this.nodeDefs[descriptor.name] = descriptor;
        this._nodeClasses[descriptor.name] = cls;
    }

    protected _createNode(cfg: NodeData, treeCfg: TreeData) {
        const NodeCls = this._nodeClasses[cfg.name];
        const descriptor = this.nodeDefs[cfg.name];

        if (!NodeCls || !descriptor) {
            throw new Error(`behavior3: node '${cfg.name}' not found`);
        }

        cfg.input ||= [];
        cfg.output ||= [];
        cfg.children ||= [];
        cfg.args ||= {};
        cfg.tree = treeCfg;

        const node = new NodeCls();

        for (const childCfg of cfg.children) {
            if (!childCfg.disabled) {
                (node.children as Node[]).push(this._createNode(childCfg, treeCfg));
            }
        }

        node.init(this, cfg);

        if (
            descriptor.children !== undefined &&
            descriptor.children !== -1 &&
            descriptor.children !== node.children.length
        ) {
            if (descriptor.children === 0) {
                node.warn(`no children is required`);
            } else if (node.children.length < descriptor.children) {
                node.error(`at least ${descriptor.children} children are required`);
            } else {
                node.warn(`exactly ${descriptor.children} children`);
            }
        }

        return node;
    }
}
