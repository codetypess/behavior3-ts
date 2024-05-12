import { Evaluator, ExpressionEvaluator } from "./evaluator";
import { Clear } from "./nodes/actions/clear";
import { Log } from "./nodes/actions/log";
import { Now } from "./nodes/actions/now";
import { Wait } from "./nodes/actions/wait";
import { Foreach } from "./nodes/composites/foreach";
import { Loop } from "./nodes/composites/loop";
import { Once } from "./nodes/decorators/once";
import { Parallel } from "./nodes/composites/parallel";
import { Selector } from "./nodes/composites/selector";
import { Sequence } from "./nodes/composites/sequence";
import { Check } from "./nodes/conditions/check";
import { IsNull } from "./nodes/conditions/is-null";
import { NotNull } from "./nodes/conditions/not-null";
import { AlwaysFail } from "./nodes/decorators/always-failure";
import { AlwaysSuccess } from "./nodes/decorators/always-success";
import { Inverter } from "./nodes/decorators/inverter";
import { RepeatUntilFailure } from "./nodes/decorators/repeat-until-failure";
import { RepeatUntilSuccess } from "./nodes/decorators/repeat-until-success";

import { Process } from "./process";
import { ObjectType } from "./tree-env";
import { Timeout } from "./nodes/decorators/timeout";

export type Constructor<T = unknown> = new (...args: unknown[]) => T;

export class Context {
    protected _processResolvers: Map<string, Process> = new Map();
    protected _evaluators: Map<string, Evaluator> = new Map();

    time: number = 0;

    constructor() {
        this.registerProcess(AlwaysFail);
        this.registerProcess(AlwaysSuccess);
        this.registerProcess(Check);
        this.registerProcess(Clear);
        this.registerProcess(Foreach);
        this.registerProcess(Inverter);
        this.registerProcess(IsNull);
        this.registerProcess(Log);
        this.registerProcess(Loop);
        this.registerProcess(NotNull);
        this.registerProcess(Now);
        this.registerProcess(Once);
        this.registerProcess(Parallel);
        this.registerProcess(RepeatUntilFailure);
        this.registerProcess(RepeatUntilSuccess);
        this.registerProcess(Selector);
        this.registerProcess(Sequence);
        this.registerProcess(Timeout);
        this.registerProcess(Wait);
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
