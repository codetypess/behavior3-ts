import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { TreeEvent } from "../../src/behavior3";
import { captureConsole, cond, n, NodeSpec, probe, TestContext } from "./helpers";

const err = (id: string, opts = {}) => probe(id, { args: { status: "error" }, ...opts });

const run = (spec: NodeSpec, values: Record<string, unknown> = {}) => {
    const ctx = new TestContext();
    const tree = ctx.createTree(spec);
    for (const k in values) tree.blackboard.set(k, values[k]);
    const { result, warn } = captureConsole(() => tree.tick());
    return { status: result, log: ctx.takeLog(), warn, ctx, tree };
};

describe("error status", () => {
    it("is passed up without trying the next branch", () => {
        const ctx = new TestContext();
        const tree = ctx.createTree(
            n("Selector", "sel", { children: [n("Sequence", "seq", { children: [err("hero"), probe("a")] }), probe("minion")] }),
        );
        const events: string[] = [];
        for (const e of [TreeEvent.EXCEPTION, TreeEvent.INTERRUPTED, TreeEvent.TICKED]) {
            ctx.on(e, tree, (...args: unknown[]) => events.push([e, ...args].join(":")), "test");
        }
        assert.equal(tree.tick(), "error");
        assert.equal(tree.status, "error");
        assert.deepEqual(ctx.takeLog(), ["tick:hero"]);
        // finished like failure, but no exception and no interrupt
        assert.deepEqual(events, [`${TreeEvent.TICKED}:error`]);
        assert.equal(tree.isRunning(tree.root!), false);

        // the next tick starts from the root
        tree.blackboard.set("hero", "failure");
        assert.equal(tree.tick(), "success");
        assert.deepEqual(ctx.takeLog(), ["tick:hero", "tick:minion"]);
    });

    it("ErrorToFailure turns it into failure, the parent tries the next branch", () => {
        const { status, log } = run(
            n("Selector", "sel", {
                children: [
                    n("ErrorToFailure", "etf", { children: [n("Sequence", "seq", { children: [err("hero"), probe("a")] })] }),
                    probe("minion"),
                ],
            }),
        );
        assert.equal(status, "success");
        assert.deepEqual(log, ["tick:hero", "tick:minion"]);
    });

    it("ErrorToFailure returns the other statuses as they are", () => {
        for (const s of ["success", "failure", "running"]) {
            const { status } = run(n("ErrorToFailure", "etf", { children: [probe("a")] }), { a: s });
            assert.equal(status, s);
        }
    });

    it("ErrorToFailure doesn't handle exceptions", () => {
        const { status, log } = run(
            n("Selector", "sel", { children: [n("ErrorToFailure", "etf", { children: [n("Throw", "t")] }), probe("b")] }),
        );
        assert.equal(status, "exception");
        assert.deepEqual(log, []);
    });

    it("every builtin composite and decorator returns error", () => {
        const one = (name: string, opts = {}) => n(name, name, { children: [err("e")], ...opts });
        const specs: NodeSpec[] = [
            n("Sequence", "Sequence", { children: [err("e"), probe("x")] }),
            n("Selector", "Selector", { children: [err("e"), probe("x")] }),
            n("Parallel", "Parallel", { children: [err("e"), probe("x")] }),
            n("Race", "Race", { children: [err("e"), probe("x")] }),
            n("IfElse", "IfElse", { children: [err("e"), probe("x"), probe("x")] }),
            n("Switch", "Switch", { children: [n("Case", "c", { children: [err("e"), probe("x")] }), n("Case", "c2", { children: [probe("x"), probe("x")] })] }),
            one("Invert"),
            one("AlwaysSuccess"),
            one("AlwaysFailure"),
            one("AlwaysRunning"),
            one("Repeat", { args: { count: 3 } }),
            one("RetryUntilSuccess", { args: { count: 3 } }),
            one("RetryUntilFailure", { args: { count: 3 } }),
            one("Timeout", { args: { time: 1 } }),
            one("Once"),
            one("Assert", { args: { message: "m" } }),
            one("ForEach", { input: ["arr"], output: ["v"] }),
            one("Filter", { input: ["arr"], output: ["v", "out"] }),
        ];
        for (const spec of specs) {
            const { status, log } = run(spec, { arr: [1, 2] });
            assert.equal(status, "error", spec.name);
            assert.deepEqual(log, ["tick:e"], spec.name);
        }
    });

    it("Once is not used up by an error", () => {
        const ctx = new TestContext();
        const tree = ctx.createTree(n("Once", "once", { children: [probe("a")] }));
        tree.blackboard.set("a", "error");
        assert.equal(tree.tick(), "error");
        tree.blackboard.set("a", "success");
        assert.equal(tree.tick(), "success");
        assert.equal(tree.tick(), "failure");
    });

    it("aborts the running siblings in Parallel", () => {
        const ctx = new TestContext();
        const tree = ctx.createTree(n("Parallel", "par", { children: [probe("a"), probe("b")] }));
        tree.blackboard.set("a", "running");
        tree.blackboard.set("b", "running");
        tree.tick();
        ctx.takeLog();
        tree.blackboard.set("a", "error");
        assert.equal(tree.tick(), "error");
        assert.deepEqual(ctx.takeLog(), ["tick:a", "abort:b"]);
        assert.equal(tree.isRunning(tree.root!.children[1]), false);
    });

    it("clears the states of the subtree, the next tick starts over", () => {
        const ctx = new TestContext();
        // Invert is not running itself, the state of the Selector below must be cleared anyway
        const tree = ctx.createTree(
            n("ErrorToFailure", "etf", {
                children: [n("Invert", "inv", { children: [n("Selector", "sel", { children: [probe("a"), probe("b")] })] })],
            }),
        );
        tree.blackboard.set("a", "failure");
        tree.blackboard.set("b", "running");
        assert.equal(tree.tick(), "running");
        tree.blackboard.set("b", "error");
        assert.equal(tree.tick(), "failure");
        ctx.takeLog();
        tree.blackboard.set("b", "success");
        tree.tick();
        assert.deepEqual(ctx.takeLog(), ["tick:a", "tick:b"]);
    });

    it("is a plain status, a custom node decides what to return", () => {
        // the framework doesn't step in: Leaky returns success whatever the child returns
        const leaky = run(n("Selector", "sel", { children: [n("Leaky", "l", { children: [err("e")] }), probe("b")] }));
        assert.equal(leaky.status, "success");
        assert.deepEqual(leaky.log, ["tick:e"]);

        // a custom composite passing error up
        const ps = run(n("PrioritySelector", "ps", { children: [err("e"), probe("b")] }));
        assert.equal(ps.status, "error");
        assert.deepEqual(ps.log, ["tick:e"]);
    });

    it("prints the reason as a warning, not as an error", () => {
        const ctx = new TestContext();
        const tree = ctx.createTree(n("GetField", "g", { args: { field: "hp" }, input: ["obj"] }));
        let exceptions = 0;
        ctx.on(TreeEvent.EXCEPTION, tree, () => exceptions++, "test");
        const { result, warn, error } = captureConsole(() => tree.tick());
        assert.equal(result, "error");
        assert.match(warn[0], /GetField#g: invalid object: undefined/);
        assert.deepEqual(error, []);
        assert.equal(exceptions, 0);
    });
});

describe("error in conditions", () => {
    // a condition is only true or false: error is false, the decorated node is not run

    it("is false when entering", () => {
        const { status, log } = run(
            n("Selector", "sel", { children: [probe("a", { conditions: [cond(err("c"))] }), probe("b")] }),
        );
        assert.equal(status, "success");
        assert.deepEqual(log, ["tick:c", "tick:b"]);
    });

    it("aborts the running node when a self condition returns error", () => {
        const ctx = new TestContext();
        const tree = ctx.createTree(probe("a", { conditions: [cond(probe("c"), "self")] }));
        tree.blackboard.set("a", "running");
        tree.tick();
        ctx.takeLog();
        tree.blackboard.set("c", "error");
        assert.equal(tree.tick(), "failure");
        assert.deepEqual(ctx.takeLog(), ["tick:c", "abort:a"]);
        assert.equal(tree.isRunning(tree.root!), false);
    });

    it("doesn't preempt when a lower condition returns error", () => {
        for (const parent of ["Selector", "PrioritySelector"]) {
            const ctx = new TestContext();
            const tree = ctx.createTree(
                n(parent, "sel", { children: [probe("a", { conditions: [cond(probe("c"), "lower")] }), probe("b")] }),
            );
            tree.blackboard.set("c", "failure");
            tree.blackboard.set("b", "running");
            tree.tick();
            ctx.takeLog();
            tree.blackboard.set("c", "error");
            assert.equal(tree.tick(), "running", parent);
            assert.deepEqual(ctx.takeLog(), ["tick:c", "tick:b"], parent);
        }
    });

    it("stops at the first error", () => {
        const { status, log } = run(probe("a", { conditions: [cond(err("c1")), cond(probe("c2"))] }));
        assert.equal(status, "failure");
        assert.deepEqual(log, ["tick:c1"]);
    });

    it("a condition node in the main tree still returns error", () => {
        const { status, log } = run(n("Selector", "sel", { children: [err("isHero"), probe("minion")] }));
        assert.equal(status, "error");
        assert.deepEqual(log, ["tick:isHero"]);
    });
});

describe("error in callbacks", () => {
    it("doesn't affect the tick dispatching the event", () => {
        const { status, log } = run(
            n("Sequence", "seq", {
                children: [
                    n("Once", "once", { children: [n("Listen", "l", { args: { event: "e" }, children: [err("x")] })] }),
                    n("Emit", "emit", { args: { event: "e" } }),
                    probe("main"),
                ],
            }),
        );
        assert.equal(status, "success");
        assert.deepEqual(log, ["tick:x", "tick:main"]);
    });

    it("doesn't affect the running tree", () => {
        const ctx = new TestContext();
        const tree = ctx.createTree(
            n("Sequence", "seq", {
                children: [
                    n("Once", "once", {
                        children: [
                            n("Listen", "l", {
                                args: { event: "e" },
                                children: [n("Selector", "sel", { children: [err("x"), probe("fallback")] })],
                            }),
                        ],
                    }),
                    probe("main", { args: { status: "running" } }),
                ],
            }),
        );
        tree.tick();
        ctx.takeLog();
        captureConsole(() => ctx.dispatch("e"));
        // no fallback in the callback, and the main branch is still running
        assert.deepEqual(ctx.takeLog(), ["tick:x"]);
        assert.equal(tree.status, "running");
        assert.equal(tree.tick(), "running");
        assert.deepEqual(ctx.takeLog(), ["tick:main"]);
    });
});
