import { Evaluator, ExpressionEvaluator } from "./evaluator";
import { Index } from "./nodes/actions";
import { Calculate } from "./nodes/actions/calculate";
import { Clear } from "./nodes/actions/clear";
import { Concat } from "./nodes/actions/concat";
import { Filter } from "./nodes/actions/filter";
import { Foreach } from "./nodes/actions/foreach";
import { Let } from "./nodes/actions/let";
import { Log } from "./nodes/actions/log";
import { Now } from "./nodes/actions/now";
import { Push } from "./nodes/actions/push";
import { Random } from "./nodes/actions/random";
import { RandomIndex } from "./nodes/actions/random_index";
import { Wait } from "./nodes/actions/wait";
import { IfElse } from "./nodes/composites/ifelse";
import { Parallel } from "./nodes/composites/parallel";
import { Selector } from "./nodes/composites/selector";
import { Sequence } from "./nodes/composites/sequence";
import { Check } from "./nodes/conditions/check";
import { Includes } from "./nodes/conditions/includes";
import { IsNull } from "./nodes/conditions/is-null";
import { IsStatus } from "./nodes/conditions/is-status";
import { NotNull } from "./nodes/conditions/not-null";
import { AlwaysFail } from "./nodes/decorators/always-failure";
import { AlwaysSuccess } from "./nodes/decorators/always-success";
import { Assert } from "./nodes/decorators/assert";
import { Delay } from "./nodes/decorators/delay";
import { Invert } from "./nodes/decorators/invert";
import { Listen } from "./nodes/decorators/listen";
import { Once } from "./nodes/decorators/once";
import { Repeat } from "./nodes/decorators/repeat";
import { RepeatUntilFailure } from "./nodes/decorators/repeat-until-failure";
import { RepeatUntilSuccess } from "./nodes/decorators/repeat-until-success";
import { Timeout } from "./nodes/decorators/timeout";
import { Process } from "./process";

export type Constructor<T> = new (...args: unknown[]) => T;
export type Callback<A extends unknown[] = unknown[]> = (...args: A) => void;
export type ObjectType = { [k: string]: unknown };
export type TargetType = object | string | number;
export type TagType = unknown;

export class Context {
    protected _processResolvers: Map<string, Process> = new Map();
    protected _evaluators: Map<string, Evaluator> = new Map();
    protected _time: number = 0;
    protected _delays: Map<Callback, [TagType, number]> = new Map();

    protected _listenerMap: Map<string, Map<TargetType, Map<Callback, TagType>>> = new Map();

    constructor() {
        this.registerProcess(AlwaysFail);
        this.registerProcess(AlwaysSuccess);
        this.registerProcess(Assert);
        this.registerProcess(Calculate);
        this.registerProcess(Check);
        this.registerProcess(Clear);
        this.registerProcess(Concat);
        this.registerProcess(Delay);
        this.registerProcess(Filter);
        this.registerProcess(Foreach);
        this.registerProcess(IfElse);
        this.registerProcess(Includes);
        this.registerProcess(Index);
        this.registerProcess(Invert);
        this.registerProcess(IsNull);
        this.registerProcess(IsStatus);
        this.registerProcess(Let);
        this.registerProcess(Listen);
        this.registerProcess(Log);
        this.registerProcess(NotNull);
        this.registerProcess(Now);
        this.registerProcess(Once);
        this.registerProcess(Parallel);
        this.registerProcess(Push);
        this.registerProcess(Random);
        this.registerProcess(RandomIndex);
        this.registerProcess(Repeat);
        this.registerProcess(RepeatUntilFailure);
        this.registerProcess(RepeatUntilSuccess);
        this.registerProcess(Selector);
        this.registerProcess(Sequence);
        this.registerProcess(Timeout);
        this.registerProcess(Wait);
    }

    get time() {
        return this._time;
    }

    get processResolvers(): Map<string, Process> {
        return this._processResolvers;
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
        let evaluator = this._evaluators.get(code);
        if (!evaluator) {
            const expr = new ExpressionEvaluator(code);
            evaluator = (envars: ObjectType) => expr.evaluate(envars);
            this._evaluators.set(code, evaluator);
        }
        return evaluator;
    }

    registerCode(code: string, evaluator: Evaluator) {
        this._evaluators.set(code, evaluator);
    }

    registerProcess<T extends Process>(cls: Constructor<T>) {
        const process = new cls();
        this._processResolvers.set(process.descriptor.name, process);
    }

    findProcess(name: string) {
        return this._processResolvers.get(name);
    }
}
