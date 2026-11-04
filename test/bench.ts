/**
 * Benchmark of the runtime, run by `npm run bench`.
 * Not a part of `npm test`, compare the numbers before and after changing the runtime.
 *
 * Like in a game, the units of a scenario share one tree (one node graph), each unit has its
 * own `Tree`. Besides the time, the GC count and time of the timed ticks are printed, and the
 * change of the used heap as a rough hint of the allocations.
 */
import assert from "node:assert/strict";
import { performance, PerformanceObserver } from "node:perf_hooks";
import { Tree } from "../src/behavior3";
import { cond, n, NodeSpec, TestContext } from "./unit/helpers";

const TREES = 1000;
const TICKS = 1000;
const WARMUP = 100;

const check = (id: string, value: string) => n("Check", id, { args: { value } });
const wait = (id: string) => n("Wait", id, { args: { time: 1e9 } });

/** 8 levels, Parallel and Timeout on the running path. */
const deep: NodeSpec = n("Sequence", "1", {
    children: [
        check("2", "hp > 0"),
        n("Selector", "3", {
            children: [
                n("Sequence", "4", { children: [check("5", "hp < 0"), wait("6")] }),
                n("Sequence", "7", {
                    children: [
                        n("Let", "8", { args: { value: 1 }, output: ["x"] }),
                        n("Parallel", "9", {
                            children: [
                                n("Timeout", "10", {
                                    args: { time: 1e9 },
                                    children: [
                                        n("Sequence", "11", {
                                            children: [
                                                n("Calculate", "12", { args: { value: "x + 1" }, output: ["y"] }),
                                                n("Invert", "13", {
                                                    children: [n("AlwaysFailure", "14", { children: [wait("15")] })],
                                                }),
                                            ],
                                        }),
                                    ],
                                }),
                                n("AlwaysSuccess", "16", {
                                    children: [n("Selector", "17", { children: [check("18", "x > 5"), wait("19")] })],
                                }),
                            ],
                        }),
                    ],
                }),
            ],
        }),
    ],
});

/** Conditions and preemption: flee > attack > patrol, the enemy appears and leaves. */
const preempt: NodeSpec = n("Selector", "1", {
    children: [
        n("Sequence", "2", {
            conditions: [cond(check("3", "hp < 20"), "both")],
            children: [n("Log", "4", { args: { message: "flee" } }), wait("5")],
        }),
        n("Sequence", "6", {
            conditions: [cond(check("7", "enemy > 0"), "both"), cond(check("8", "hp >= 20"), "self")],
            children: [wait("9")],
        }),
        n("Sequence", "10", { children: [n("Calculate", "11", { args: { value: "step + 1" }, output: ["step"] }), wait("12")] }),
    ],
});

/** Runs to the end every tick: the expressions are evaluated every tick. */
const evaluate: NodeSpec = n("Sequence", "1", {
    children: [
        check("2", "hp > 0"),
        n("Calculate", "3", { args: { value: "atk * 2 - def" }, output: ["dmg"] }),
        n("Selector", "4", {
            children: [
                check("5", "dmg > 100"),
                n("Calculate", "6", { args: { value: "hp - dmg" }, output: ["left"] }),
            ],
        }),
        n("Calculate", "7", { args: { value: "step + 1" }, output: ["step"] }),
    ],
});

/** Enters a Scope every tick, writes in it and exports one variable. */
const scope: NodeSpec = n("Sequence", "1", {
    children: [
        n("Scope", "2", {
            output: ["step"],
            children: [
                n("Sequence", "3", {
                    children: [
                        n("Let", "4", { args: { value: 1 }, output: ["one"] }),
                        n("Calculate", "5", { args: { value: "step + one" }, output: ["step"] }),
                    ],
                }),
            ],
        }),
    ],
});

/** Runs a small tree with RunTree every tick: input, output and the reused instance. */
const runTree: NodeSpec = n("RunTree", "1", {
    args: { path: "bench-sub" },
    input: ["", "step"],
    output: ["step"],
});
const runTreeSub: NodeSpec = n("Calculate", "1", { args: { value: "step + 1" }, output: ["step"] });

/** The event of the unit is dispatched every tick, the bound callback of Listen ticks its child. */
const callback: NodeSpec = n("Once", "1", {
    children: [
        n("Listen", "2", {
            args: { event: "hit" },
            input: ["self"],
            children: [n("Calculate", "3", { args: { value: "step + 1" }, output: ["step"] })],
        }),
    ],
});

type Unit = { tree: Tree<TestContext, unknown> };

type Scenario = {
    spec: NodeSpec;
    /** Other trees used by the scenario, by path. */
    trees?: Record<string, NodeSpec>;
    /** Called before every tick of every unit. */
    update?: (tick: number, unit: Unit) => void;
    /**
     * Checks that the scenario runs what it measures: `step` is incremented every tick, except
     * this number of ticks.
     */
    steps?: number;
};

let path = 0;

/** The GC entries are delivered asynchronously, after the synchronous ticks. */
const gcEntries: { startTime: number; duration: number }[] = [];
const gc = new PerformanceObserver((list) => gcEntries.push(...list.getEntries()));
gc.observe({ entryTypes: ["gc"] });
const flush = () => new Promise((resolve) => setImmediate(resolve));

const run = async (name: string, scenario: Scenario) => {
    const ctx = new TestContext();
    for (const [p, spec] of Object.entries(scenario.trees ?? {})) {
        ctx.defineTree(p, spec);
    }
    // one tree shared by all the units
    const shared = `bench-${++path}`;
    ctx.defineTree(shared, scenario.spec);
    const units: Unit[] = Array.from({ length: TREES }, () => {
        const unit = {} as Unit;
        const tree = new Tree(ctx, unit, shared);
        unit.tree = tree;
        tree.blackboard.set("self", unit);
        tree.blackboard.set("hp", 100);
        tree.blackboard.set("atk", 30);
        tree.blackboard.set("def", 10);
        tree.blackboard.set("enemy", 0);
        tree.blackboard.set("step", 0);
        return unit;
    });
    const tickAll = (tick: number) => {
        for (const unit of units) {
            scenario.update?.(tick, unit);
            unit.tree.tick();
        }
        ctx.update(0.016);
    };

    for (let i = 0; i < WARMUP; i++) {
        tickAll(i);
    }
    const heap = process.memoryUsage().heapUsed;
    const start = performance.now();
    for (let i = 0; i < TICKS; i++) {
        tickAll(i);
    }
    const end = performance.now();
    const ms = end - start;
    const heapMb = (process.memoryUsage().heapUsed - heap) / 1024 / 1024;
    await flush();
    await flush();
    const gcs = gcEntries.filter((e) => e.startTime >= start && e.startTime <= end);
    const gcMs = gcs.reduce((sum, e) => sum + e.duration, 0);

    if (scenario.steps !== undefined) {
        for (const unit of units) {
            const step = unit.tree.blackboard.get("step");
            assert.equal(step, WARMUP + TICKS - scenario.steps, `${name}: step`);
        }
    }

    const ns = (ms * 1e6) / (TREES * TICKS);
    console.log(
        `${name.padEnd(10)} ${ms.toFixed(0).padStart(6)} ms ${ns.toFixed(0).padStart(6)} ns/tick ` +
            `${String(gcs.length).padStart(5)} gc ${gcMs.toFixed(1).padStart(7)} ms ` +
            `${heapMb.toFixed(1).padStart(7)} MB heap`,
    );
};

console.log(`${TREES} units x ${TICKS} ticks, every scenario shares one tree`);
console.log(`${"".padEnd(10)} ${"time".padStart(9)} ${"per tick".padStart(14)} ${"gc".padStart(8)} ${"gc time".padStart(10)} ${"heap Δ".padStart(10)}`);
await run("deep", { spec: deep });
await run("preempt", {
    spec: preempt,
    update: (tick, unit) => {
        // the enemy appears every 50 ticks for 25 ticks
        unit.tree.blackboard.set("enemy", tick % 50 < 25 ? 1 : 0);
    },
});
await run("eval", { spec: evaluate, steps: 0 });
await run("scope", { spec: scope, steps: 0 });
await run("runtree", { spec: runTree, trees: { "bench-sub": runTreeSub }, steps: 0 });
await run("callback", {
    spec: callback,
    // the first event is dispatched before Listen registers in the first tick
    update: (_tick, unit) => unit.tree.context.dispatch("hit", unit),
    steps: 1,
});
gc.disconnect();
