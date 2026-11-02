import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Tree } from "../../src/behavior3";
import { captureConsole, cond, n, probe, TestContext } from "./helpers";

const check = (id: string, value: string) => n("Check", id, { args: { value } });
const setState = (id: string, value: string) => n("Let", id, { args: { value }, output: ["state"] });
const wait = (id: string, time: number) => n("Wait", id, { args: { time } });

describe("guard monster", () => {
    /** flee > attack > patrol, with real nodes. */
    const guard = () =>
        n("Selector", "sel", {
            children: [
                n("Sequence", "flee", {
                    conditions: [cond(check("lowHp", "hp < 20"), "lower")],
                    children: [setState("s1", "flee"), wait("w1", 2)],
                }),
                n("Sequence", "attack", {
                    conditions: [cond(n("NotNull", "hasEnemy", { input: ["enemy"] }), "both")],
                    children: [setState("s2", "attack"), wait("w2", 100)],
                }),
                n("Sequence", "patrol", {
                    children: [
                        setState("s3", "patrol"),
                        n("Parallel", "par", {
                            children: [n("WaitForEvent", "arrived", { args: { event: "arrived" } }), wait("w3", 100)],
                        }),
                    ],
                }),
            ],
        });

    it("switches behaviors frame by frame", () => {
        const ctx = new TestContext();
        const tree = ctx.createTree(guard());
        const bb = tree.blackboard;
        const step = (expected: string) => {
            ctx.update(1);
            assert.equal(tree.tick(), "running");
            assert.equal(bb.get("state"), expected);
        };

        bb.set("hp", 100);
        step("patrol");
        assert.equal(ctx.listenerCount("arrived"), 1);

        bb.set("enemy", {});
        step("attack");
        // the Parallel in patrol is aborted, WaitForEvent removes its listener
        assert.equal(ctx.listenerCount("arrived"), 0);

        bb.set("enemy", undefined);
        step("patrol");
        assert.equal(ctx.listenerCount("arrived"), 1);

        bb.set("enemy", {});
        bb.set("hp", 10);
        step("flee");

        bb.set("hp", 100);
        step("flee");
        ctx.update(1);
        assert.equal(tree.tick(), "success");
        step("attack");
    });

    it("runs many trees sharing the same nodes independently", () => {
        const ctx = new TestContext();
        const t1 = ctx.createTree(guard());
        const t2 = new Tree(ctx, {}, t1.path);
        t1.blackboard.set("hp", 100);
        t2.blackboard.set("hp", 100);
        t1.tick();
        t2.tick();
        assert.equal(ctx.listenerCount("arrived"), 2);

        t1.blackboard.set("enemy", {});
        t1.tick();
        t2.tick();
        assert.equal(t1.blackboard.get("state"), "attack");
        assert.equal(t2.blackboard.get("state"), "patrol");
        assert.equal(ctx.listenerCount("arrived"), 1);

        // the event only finishes the patrol of t2
        ctx.dispatch("arrived");
        t2.tick();
        assert.equal(t2.isRunning(t2.root!.children[2].children[1].children[0]), false);
    });
});

describe("conditions in composites", () => {
    it("self abort inside a Parallel branch", () => {
        const ctx = new TestContext();
        const tree = ctx.createTree(
            n("Parallel", "par", {
                args: { successCount: 1 },
                children: [
                    n("Group", "g", { conditions: [cond(probe("ok"), "self")], children: [probe("a")] }),
                    probe("b"),
                ],
            }),
        );
        tree.blackboard.set("a", "running");
        tree.blackboard.set("b", "running");
        tree.tick();
        ctx.takeLog();
        tree.blackboard.set("ok", "failure");
        assert.equal(tree.tick(), "running");
        assert.deepEqual(ctx.takeLog(), ["tick:ok", "abort:a", "abort:g", "tick:b"]);
        // the aborted branch fails, one success is enough
        tree.blackboard.set("b", "success");
        assert.equal(tree.tick(), "success");
        assert.deepEqual(ctx.takeLog(), ["tick:b"]);
    });

    it("preemption inside a Race branch", () => {
        const ctx = new TestContext();
        const tree = ctx.createTree(
            n("Race", "race", {
                children: [
                    n("Selector", "sel", {
                        children: [
                            probe("high", { conditions: [cond(probe("go"), "lower")] }),
                            probe("low", { args: { status: "running" } }),
                        ],
                    }),
                    probe("other", { args: { status: "running" } }),
                ],
            }),
        );
        tree.blackboard.set("go", "failure");
        tree.tick();
        ctx.takeLog();
        tree.blackboard.set("go", "success");
        assert.equal(tree.tick(), "success");
        // high preempts low and succeeds, then the race aborts other
        assert.deepEqual(ctx.takeLog(), ["tick:go", "abort:low", "tick:high", "abort:other"]);
    });

    it("Timeout aborts a subtree with preemption", () => {
        const ctx = new TestContext();
        const tree = ctx.createTree(
            n("Timeout", "t", {
                args: { time: 2 },
                children: [
                    n("Selector", "sel", {
                        children: [
                            probe("high", { args: { status: "running" }, conditions: [cond(probe("go"), "lower")] }),
                            probe("low", { args: { status: "running" } }),
                        ],
                    }),
                ],
            }),
        );
        tree.blackboard.set("go", "failure");
        tree.tick();
        tree.blackboard.set("go", "success");
        ctx.update(1);
        tree.tick();
        ctx.takeLog();
        ctx.update(1);
        assert.equal(tree.tick(), "failure");
        assert.deepEqual(ctx.takeLog(), ["abort:high"]);
        const sel = tree.root!.children[0];
        assert.equal(tree.isRunning(sel), false);
    });

    it("Repeat restarts the preemptive selector every iteration", () => {
        const ctx = new TestContext();
        const tree = ctx.createTree(
            n("Repeat", "r", {
                args: { count: 2 },
                children: [
                    n("Selector", "sel", {
                        children: [
                            probe("high", { conditions: [cond(probe("go"), "lower")] }),
                            probe("low"),
                        ],
                    }),
                ],
            }),
        );
        tree.blackboard.set("go", "failure");
        tree.blackboard.set("low", "running");
        tree.tick();
        ctx.takeLog();
        tree.blackboard.set("go", "success");
        // iteration 1: high preempts low; iteration 2: high is entered normally
        assert.equal(tree.tick(), "success");
        assert.deepEqual(ctx.takeLog(), ["tick:go", "abort:low", "tick:high", "tick:go", "tick:high"]);
    });

    it("conditions read the loop variable of ForEach", () => {
        const ctx = new TestContext();
        const tree = ctx.createTree(
            n("ForEach", "each", {
                input: ["arr"],
                output: ["item"],
                children: [
                    n("AlwaysSuccess", "as", {
                        children: [
                            n("Push", "push", {
                                input: ["out", "item"],
                                conditions: [cond(check("even", "item % 2 == 0"))],
                            }),
                        ],
                    }),
                ],
            }),
        );
        const out: number[] = [];
        tree.blackboard.set("arr", [1, 2, 3, 4]);
        tree.blackboard.set("out", out);
        assert.equal(tree.tick(), "success");
        assert.deepEqual(out, [2, 4]);
    });

    it("self condition on the action of a Switch case", () => {
        const ctx = new TestContext();
        const tree = ctx.createTree(
            n("Switch", "sw", {
                children: [
                    n("Case", "case", {
                        children: [probe("match"), probe("act", { conditions: [cond(probe("ok"), "self")] })],
                    }),
                ],
            }),
        );
        tree.blackboard.set("act", "running");
        tree.tick();
        ctx.takeLog();
        tree.blackboard.set("ok", "failure");
        assert.equal(tree.tick(), "failure");
        assert.deepEqual(ctx.takeLog(), ["tick:ok", "abort:act"]);
        assert.equal(tree.isRunning(tree.root!), false);
    });

    it("conditions on IfElse branches", () => {
        const ctx = new TestContext();
        const tree = ctx.createTree(
            n("IfElse", "if", {
                children: [probe("c"), probe("yes", { conditions: [cond(probe("allowed"))] }), probe("no")],
            }),
        );
        tree.blackboard.set("allowed", "failure");
        // the branch is not entered, IfElse returns its failure
        assert.equal(tree.tick(), "failure");
        assert.deepEqual(ctx.takeLog(), ["tick:c", "tick:allowed"]);
    });

    it("self abort of an ancestor aborts the whole running path", () => {
        const ctx = new TestContext();
        const tree = ctx.createTree(
            n("Group", "root", {
                conditions: [cond(probe("ok"), "self")],
                children: [
                    n("Group", "g1", {
                        children: [n("Group", "g2", { children: [probe("leaf", { args: { status: "running" } })] })],
                    }),
                ],
            }),
        );
        const { warn } = captureConsole(() => tree.tick());
        assert.equal(warn.length, 0);
        ctx.takeLog();
        tree.blackboard.set("ok", "failure");
        assert.equal(tree.tick(), "failure");
        assert.deepEqual(ctx.takeLog(), ["tick:ok", "abort:leaf", "abort:g2", "abort:g1", "abort:root"]);
    });

    it("both conditions at several levels", () => {
        const ctx = new TestContext();
        const tree = ctx.createTree(
            n("Selector", "outer", {
                children: [
                    n("Selector", "combat", {
                        conditions: [cond(probe("inCombat"), "both")],
                        children: [
                            probe("skill", { conditions: [cond(probe("hasMana"), "lower")] }),
                            probe("hit", { args: { status: "running" } }),
                        ],
                    }),
                    probe("idle", { args: { status: "running" } }),
                ],
            }),
        );
        const bb = tree.blackboard;
        bb.set("inCombat", "failure");
        bb.set("hasMana", "failure");
        tree.tick();
        assert.deepEqual(ctx.takeLog(), ["tick:inCombat", "tick:idle"]);

        // the outer selector preempts idle, then combat runs hit
        bb.set("inCombat", "success");
        tree.tick();
        assert.deepEqual(ctx.takeLog(), ["tick:inCombat", "abort:idle", "tick:hasMana", "tick:hit"]);

        // the inner selector preempts hit
        bb.set("hasMana", "success");
        bb.set("skill", "running");
        tree.tick();
        assert.deepEqual(ctx.takeLog(), ["tick:inCombat", "tick:hasMana", "abort:hit", "tick:skill"]);

        // combat aborts itself, the running skill is aborted too
        bb.set("inCombat", "failure");
        tree.tick();
        assert.deepEqual(ctx.takeLog(), ["tick:inCombat", "abort:skill", "tick:idle"]);
    });

    it("interrupt during a preempted tick", () => {
        const ctx = new TestContext();
        const tree = ctx.createTree(
            n("Selector", "sel", {
                children: [
                    n("Sequence", "high", {
                        conditions: [cond(probe("go"), "lower")],
                        children: [n("Interrupt", "i"), probe("never")],
                    }),
                    probe("low", { args: { status: "running" } }),
                ],
            }),
        );
        tree.blackboard.set("go", "failure");
        tree.tick();
        ctx.takeLog();
        tree.blackboard.set("go", "success");
        assert.equal(tree.tick(), "interrupted");
        assert.deepEqual(ctx.takeLog(), ["tick:go", "abort:low"]);
        tree.blackboard.set("go", "failure");
        assert.equal(tree.tick(), "running");
        assert.deepEqual(ctx.takeLog(), ["tick:go", "tick:low"]);
    });
});

describe("events and callbacks", () => {
    it("Listen keeps listening after its branch is preempted", () => {
        const ctx = new TestContext();
        const tree = ctx.createTree(
            n("Selector", "sel", {
                children: [
                    probe("high", { args: { status: "running" }, conditions: [cond(probe("go"), "lower")] }),
                    n("Sequence", "low", {
                        children: [
                            n("Listen", "l", { args: { event: "ping" }, children: [probe("onPing")] }),
                            probe("work", { args: { status: "running" } }),
                        ],
                    }),
                ],
            }),
        );
        tree.blackboard.set("go", "failure");
        tree.tick();
        tree.blackboard.set("go", "success");
        tree.tick();
        ctx.takeLog();
        ctx.dispatch("ping");
        assert.deepEqual(ctx.takeLog(), ["tick:onPing"]);
        tree.clear();
        assert.deepEqual(ctx.takeLog(), ["abort:high"]);
        ctx.dispatch("ping");
        assert.deepEqual(ctx.takeLog(), []);
    });

    it("WaitForEvent in a Race against a Wait", () => {
        const ctx = new TestContext();
        const tree = ctx.createTree(
            n("Race", "race", {
                children: [n("WaitForEvent", "e", { args: { event: "go" } }), wait("w", 3)],
            }),
        );
        tree.tick();
        ctx.update(3);
        assert.equal(tree.tick(), "success");
        // the losing WaitForEvent is aborted
        assert.equal(ctx.listenerCount("go"), 0);
    });

    it("Delay restores the cached variables", () => {
        const ctx = new TestContext();
        const tree = ctx.createTree(
            n("Delay", "d", {
                args: { delay: 1, cacheVars: ["target"] },
                children: [n("Let", "copy", { input: ["target"], output: ["seen"] })],
            }),
        );
        tree.blackboard.set("target", "a");
        tree.tick();
        tree.blackboard.set("target", "b");
        ctx.update(1);
        assert.equal(tree.blackboard.get("seen"), "a");
        assert.equal(tree.blackboard.get("target"), "b");
    });
});
