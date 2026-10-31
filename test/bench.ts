/**
 * Benchmark of the runtime, run by `npm run bench`.
 * Not a part of `npm test`, compare the numbers before and after changing the runtime.
 */
import { performance } from "node:perf_hooks";
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

const run = (name: string, spec: NodeSpec, update?: (tick: number, values: Record<string, unknown>) => void) => {
    const ctx = new TestContext();
    const trees = Array.from({ length: TREES }, () => {
        const tree = ctx.createTree(spec);
        tree.blackboard.set("hp", 100);
        tree.blackboard.set("enemy", 0);
        tree.blackboard.set("step", 0);
        return tree;
    });
    const tickAll = (tick: number) => {
        for (const tree of trees) {
            update?.(tick, tree.blackboard.values);
            tree.tick();
        }
        ctx.update(0.016);
    };

    for (let i = 0; i < WARMUP; i++) {
        tickAll(i);
    }
    const start = performance.now();
    for (let i = 0; i < TICKS; i++) {
        tickAll(i);
    }
    const ms = performance.now() - start;
    const ns = (ms * 1e6) / (TREES * TICKS);
    console.log(`${name.padEnd(10)} ${ms.toFixed(0).padStart(6)} ms  ${ns.toFixed(0).padStart(5)} ns/tick`);
};

console.log(`${TREES} trees x ${TICKS} ticks`);
run("deep", deep);
run("preempt", preempt, (tick, values) => {
    // the enemy appears every 50 ticks for 25 ticks
    values.enemy = tick % 50 < 25 ? 1 : 0;
});
