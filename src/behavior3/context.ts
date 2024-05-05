import { Evaluator, ExpressionEvaluator } from "./evaluator";
import { Clear } from "./nodes/actions/clear";
import { GetTime } from "./nodes/actions/get-time";
import { Log } from "./nodes/actions/log";
import { Wait } from "./nodes/actions/wait";
import { Foreach } from "./nodes/composites/foreach";
import { Loop } from "./nodes/composites/loop";
import { Once } from "./nodes/composites/once";
import { Parallel } from "./nodes/composites/parallel";
import { Selector } from "./nodes/composites/selector";
import { Sequence } from "./nodes/composites/sequence";
import { Check } from "./nodes/conditions/check";
import { IsNull } from "./nodes/conditions/is-null";
import { NotNull } from "./nodes/conditions/not-null";
import { AlwaysFail } from "./nodes/decorators/always-failure";
import { AlwaysSuccess } from "./nodes/decorators/always-success";
import { Not } from "./nodes/decorators/not";
import { RepeatUntilFailure } from "./nodes/decorators/repeat-until-failure";
import { RepeatUntilSuccess } from "./nodes/decorators/repeat-until-success";

import { Process } from "./process";
import { ObjectType } from "./tree-env";

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
        this.registerProcess(GetTime);
        this.registerProcess(IsNull);
        this.registerProcess(Log);
        this.registerProcess(Loop);
        this.registerProcess(Not);
        this.registerProcess(NotNull);
        this.registerProcess(Once);
        this.registerProcess(Parallel);
        this.registerProcess(RepeatUntilFailure);
        this.registerProcess(RepeatUntilSuccess);
        this.registerProcess(Selector);
        this.registerProcess(Sequence);
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
