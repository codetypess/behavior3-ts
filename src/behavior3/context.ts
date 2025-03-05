import { Evaluator, ExpressionEvaluator } from "./evaluator";
import { Node, NodeData, NodeDef } from "./node";
import { Index } from "./nodes/actions";
import { Calculate } from "./nodes/actions/calculate";
import { Concat } from "./nodes/actions/concat";
import { GetField } from "./nodes/actions/get-field";
import { JustSuccess } from "./nodes/actions/just-success";
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
export type NodeContructor<T extends Node> = Constructor<T, ConstructorParameters<typeof Node>> & {
    descriptor: NodeDef;
};
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Callback<A extends any[] = any[]> = (...args: A) => unknown;
export type ObjectType = { [k: string]: unknown };
export type TargetType = object | string | number;
export type TagType = unknown;
export type Nullable<T> = T | null | undefined;

// prettier-ignore
export type DeepReadonly<T> =
    T extends (infer U)[] ? ReadonlyArray<DeepReadonly<U>> :
    // eslint-disable-next-line @typescript-eslint/ban-types
    T extends Function ? T :
    T extends object ? { readonly [K in keyof T]: DeepReadonly<T[K]> } :
    T;

type DelayEntry = {
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
    private readonly _delayers: DelayEntry[] = [];
    private readonly _listenerMap: Map<string, Map<TargetType, Map<Callback, TagType>>> = new Map();

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
        this.registerNode(JustSuccess);
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

    abstract loadTree(path: string): Promise<Node>;

    get time() {
        return this._time;
    }

    delay(time: number, callback: Callback, tag: TagType) {
        const expired = time + this._time;
        const delayers = this._delayers;

        let idx = delayers.findIndex((v) => v.callback === callback);
        if (idx >= 0) {
            delayers.splice(idx, 1);
        }

        idx = delayers.findIndex((v) => v.expired > expired);
        if (idx >= 0) {
            delayers.splice(idx, 0, { callback, tag, expired });
        } else {
            delayers.push({ callback, tag, expired });
        }
    }

    update(dt: number): void {
        this._time += dt;

        const delayers = this._delayers;
        if (delayers.length > 0) {
            const expired = delayers[0].expired;
            if (expired <= this._time) {
                const { callback } = delayers.shift()!;
                callback();
            }
        }
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

        const delayers = this._delayers;
        for (let i = delayers.length - 1; i >= 0; i--) {
            if (delayers[i].tag === tag) {
                delayers.splice(i, 1);
            }
        }
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

    registerNode<T extends Node>(cls: NodeContructor<T>) {
        const descriptor = cls.descriptor;
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
