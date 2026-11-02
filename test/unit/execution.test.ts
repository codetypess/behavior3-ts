import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Blackboard, Tree, TreeEvent } from "../../src/behavior3";
import { captureConsole, n, probe, TestContext } from "./helpers";

describe("execution model", () => {
    it("re-enters from the root and resumes the running child", () => {
        const ctx = new TestContext();
        const tree = ctx.createTree(n("Sequence", "seq", { children: [probe("a"), probe("b"), probe("c")] }));
        tree.blackboard.set("b", "running");

        assert.equal(tree.tick(), "running");
        assert.deepEqual(ctx.takeLog(), ["tick:a", "tick:b"]);

        // a is not ticked again, b is resumed
        assert.equal(tree.tick(), "running");
        assert.deepEqual(ctx.takeLog(), ["tick:b"]);

        tree.blackboard.set("b", "success");
        assert.equal(tree.tick(), "success");
        assert.deepEqual(ctx.takeLog(), ["tick:b", "tick:c"]);

        // the state is cleared, starts from the beginning
        assert.equal(tree.tick(), "success");
        assert.deepEqual(ctx.takeLog(), ["tick:a", "tick:b", "tick:c"]);
    });

    it("dispatches BEFORE_TICKED only when the tree is not running", () => {
        const ctx = new TestContext();
        const tree = ctx.createTree(probe("a"));
        let count = 0;
        ctx.on("treeBeforeTicked", tree, () => count++, "test");
        tree.blackboard.set("a", "running");
        tree.tick();
        tree.tick();
        assert.equal(count, 1);
        tree.blackboard.set("a", "success");
        tree.tick();
        tree.tick();
        assert.equal(count, 2);
    });
});

describe("state api", () => {
    it("keeps the state while running and clears it when finished", () => {
        const ctx = new TestContext();
        const tree = ctx.createTree(n("Sequence", "seq", { children: [probe("a"), probe("b")] }));
        const seq = tree.root!;
        const b = seq.children[1];
        tree.blackboard.set("b", "running");

        tree.tick();
        assert.equal(tree.isRunning(seq), true);
        assert.equal(tree.getState(seq), 1);
        // b returned running without setting its own state
        assert.equal(tree.isRunning(b), true);
        assert.equal(tree.getState(b), undefined);

        tree.blackboard.set("b", "success");
        tree.tick();
        assert.equal(tree.isRunning(seq), false);
        assert.equal(tree.isRunning(b), false);
        assert.equal(tree.getState(seq), undefined);
    });

    it("setState(undefined) still marks the node running", () => {
        const ctx = new TestContext();
        const tree = ctx.createTree(probe("a"));
        const a = tree.root!;
        tree.setState(a, undefined);
        assert.equal(tree.isRunning(a), true);
        assert.equal(tree.getState(a), undefined);
    });

    it("keeps states of trees sharing the same nodes apart", () => {
        const ctx = new TestContext();
        const t1 = ctx.createTree(n("Sequence", "seq", { children: [n("Wait", "w", { args: { time: 1 } }), probe("a")] }));
        // a second tree of the same path shares the node instances
        const t2 = new Tree(ctx, {}, t1.path);
        assert.equal(t1.root, t2.root);

        t1.tick();
        ctx.update(1);
        t2.tick();
        assert.equal(t1.tick(), "success");
        assert.equal(t2.status, "running");
        ctx.update(1);
        assert.equal(t2.tick(), "success");
    });
});

describe("composites", () => {
    it("Selector returns the first success", () => {
        const ctx = new TestContext();
        const tree = ctx.createTree(
            n("Selector", "sel", { children: [probe("a", { args: { status: "failure" } }), probe("b"), probe("c")] }),
        );
        assert.equal(tree.tick(), "success");
        assert.deepEqual(ctx.takeLog(), ["tick:a", "tick:b"]);
    });

    it("Selector resumes the running child and falls through on failure", () => {
        const ctx = new TestContext();
        const tree = ctx.createTree(
            n("Selector", "sel", { children: [probe("a", { args: { status: "failure" } }), probe("b"), probe("c")] }),
        );
        tree.blackboard.set("b", "running");
        assert.equal(tree.tick(), "running");
        ctx.takeLog();
        tree.blackboard.set("b", "failure");
        assert.equal(tree.tick(), "success");
        assert.deepEqual(ctx.takeLog(), ["tick:b", "tick:c"]);
    });

    it("Sequence stops at the first failure", () => {
        const ctx = new TestContext();
        const tree = ctx.createTree(
            n("Sequence", "seq", { children: [probe("a"), probe("b", { args: { status: "failure" } }), probe("c")] }),
        );
        assert.equal(tree.tick(), "failure");
        assert.deepEqual(ctx.takeLog(), ["tick:a", "tick:b"]);
    });

    it("Parallel does not tick finished children again", () => {
        const ctx = new TestContext();
        const tree = ctx.createTree(n("Parallel", "par", { children: [probe("a"), probe("b"), probe("c")] }));
        tree.blackboard.set("b", "running");
        assert.equal(tree.tick(), "running");
        assert.deepEqual(ctx.takeLog(), ["tick:a", "tick:b", "tick:c"]);
        assert.equal(tree.tick(), "running");
        assert.deepEqual(ctx.takeLog(), ["tick:b"]);
        tree.blackboard.set("b", "success");
        assert.equal(tree.tick(), "success");
        assert.deepEqual(ctx.takeLog(), ["tick:b"]);
    });

    it("Parallel fails at the first failure by default", () => {
        const ctx = new TestContext();
        const tree = ctx.createTree(n("Parallel", "par", { children: [probe("a"), probe("b"), probe("c")] }));
        tree.blackboard.set("a", "running");
        tree.blackboard.set("b", "failure");
        assert.equal(tree.tick(), "failure");
        // c is not ticked, the running a is aborted
        assert.deepEqual(ctx.takeLog(), ["tick:a", "tick:b", "abort:a"]);
    });

    it("Parallel succeeds when successCount children succeed", () => {
        const ctx = new TestContext();
        const tree = ctx.createTree(
            n("Parallel", "par", { args: { successCount: 2 }, children: [probe("a"), probe("b"), probe("c")] }),
        );
        tree.blackboard.set("b", "running");
        tree.blackboard.set("c", "running");
        assert.equal(tree.tick(), "running");
        ctx.takeLog();
        tree.blackboard.set("b", "success");
        assert.equal(tree.tick(), "success");
        assert.deepEqual(ctx.takeLog(), ["tick:b", "abort:c"]);
    });

    it("Parallel fails when successCount can't be reached", () => {
        const ctx = new TestContext();
        const tree = ctx.createTree(
            n("Parallel", "par", { args: { successCount: 2 }, children: [probe("a"), probe("b"), probe("c")] }),
        );
        tree.blackboard.set("a", "failure");
        tree.blackboard.set("b", "running");
        assert.equal(tree.tick(), "running");
        ctx.takeLog();
        // one failure is allowed, the second one makes 2 successes impossible
        tree.blackboard.set("b", "failure");
        assert.equal(tree.tick(), "failure");
        assert.deepEqual(ctx.takeLog(), ["tick:b"]);
    });

    it("Parallel with successCount 1 is like Race", () => {
        const ctx = new TestContext();
        const tree = ctx.createTree(
            n("Parallel", "par", { args: { successCount: 1 }, children: [probe("a"), probe("b")] }),
        );
        tree.blackboard.set("a", "failure");
        tree.blackboard.set("b", "running");
        assert.equal(tree.tick(), "running");
        tree.blackboard.set("b", "failure");
        assert.equal(tree.tick(), "failure");
        tree.blackboard.set("a", "running");
        tree.blackboard.set("b", "success");
        assert.equal(tree.tick(), "success");
        assert.equal(tree.isRunning(tree.root!.children[0]), false);
    });

    it("Parallel checks successCount when loading", () => {
        const ctx = new TestContext();
        for (const successCount of [0, 3, 1.5]) {
            assert.throws(
                () => ctx.createTree(n("Parallel", "par", { args: { successCount }, children: [probe("a"), probe("b")] })),
                /successCount must be in \[1, 2\]/,
            );
        }
        assert.equal(ctx.createTree(n("Parallel", "par")).tick(), "success");
    });

    it("Race succeeds with the first success and aborts the others", () => {
        const ctx = new TestContext();
        const tree = ctx.createTree(n("Race", "race", { children: [probe("a"), probe("b"), probe("c")] }));
        tree.blackboard.set("a", "running");
        tree.blackboard.set("b", "running");
        tree.blackboard.set("c", "failure");
        assert.equal(tree.tick(), "running");
        ctx.takeLog();
        tree.blackboard.set("b", "success");
        assert.equal(tree.tick(), "success");
        assert.deepEqual(ctx.takeLog(), ["tick:a", "tick:b", "abort:a"]);
    });

    it("Race fails when all children fail", () => {
        const ctx = new TestContext();
        const tree = ctx.createTree(n("Race", "race", { children: [probe("a"), probe("b")] }));
        tree.blackboard.set("a", "running");
        tree.blackboard.set("b", "failure");
        assert.equal(tree.tick(), "running");
        tree.blackboard.set("a", "failure");
        assert.equal(tree.tick(), "failure");
    });

    it("IfElse resumes the running branch without re-evaluating the condition", () => {
        const ctx = new TestContext();
        const tree = ctx.createTree(n("IfElse", "if", { children: [probe("c"), probe("yes"), probe("no")] }));
        tree.blackboard.set("yes", "running");
        assert.equal(tree.tick(), "running");
        assert.deepEqual(ctx.takeLog(), ["tick:c", "tick:yes"]);
        tree.blackboard.set("yes", "failure");
        assert.equal(tree.tick(), "failure");
        assert.deepEqual(ctx.takeLog(), ["tick:yes"]);

        tree.blackboard.set("c", "failure");
        assert.equal(tree.tick(), "success");
        assert.deepEqual(ctx.takeLog(), ["tick:c", "tick:no"]);
    });

    it("IfElse resumes a running condition", () => {
        const ctx = new TestContext();
        const tree = ctx.createTree(n("IfElse", "if", { children: [probe("c"), probe("yes"), probe("no")] }));
        tree.blackboard.set("c", "running");
        assert.equal(tree.tick(), "running");
        tree.blackboard.set("c", "success");
        assert.equal(tree.tick(), "success");
        assert.deepEqual(ctx.takeLog(), ["tick:c", "tick:c", "tick:yes"]);
    });

    it("Switch runs the action of the first matched case", () => {
        const ctx = new TestContext();
        const tree = ctx.createTree(
            n("Switch", "sw", {
                children: [
                    n("Case", "case1", { children: [probe("c1", { args: { status: "failure" } }), probe("a1")] }),
                    n("Case", "case2", { children: [probe("c2"), probe("a2")] }),
                    n("Case", "case3", { children: [probe("c3"), probe("a3")] }),
                ],
            }),
        );
        tree.blackboard.set("c2", "running");
        assert.equal(tree.tick(), "running");
        tree.blackboard.set("c2", "success");
        tree.blackboard.set("a2", "running");
        assert.equal(tree.tick(), "running");
        tree.blackboard.set("a2", "failure");
        // the action fails, the next case is not tried
        assert.equal(tree.tick(), "failure");
        assert.deepEqual(ctx.takeLog(), ["tick:c1", "tick:c2", "tick:c2", "tick:a2", "tick:a2"]);
    });

    it("Switch fails when no case matches", () => {
        const ctx = new TestContext();
        const tree = ctx.createTree(
            n("Switch", "sw", {
                children: [n("Case", "case1", { children: [probe("c1", { args: { status: "failure" } }), probe("a1")] })],
            }),
        );
        assert.equal(tree.tick(), "failure");
    });

    it("Switch only allows Case children", () => {
        const ctx = new TestContext();
        assert.throws(() => ctx.createTree(n("Switch", "sw", { children: [probe("a")] })), /only allow Case/);
    });
});

describe("decorators", () => {
    it("Invert, AlwaysSuccess and AlwaysFailure keep running", () => {
        for (const [name, success, failure] of [
            ["Invert", "failure", "success"],
            ["AlwaysSuccess", "success", "success"],
            ["AlwaysFailure", "failure", "failure"],
        ]) {
            const ctx = new TestContext();
            const tree = ctx.createTree(n(name, "d", { children: [probe("a")] }));
            assert.equal(tree.tick(), success, name);
            tree.blackboard.set("a", "failure");
            assert.equal(tree.tick(), failure, name);
            tree.blackboard.set("a", "running");
            assert.equal(tree.tick(), "running", name);
        }
    });

    it("Repeat resumes the running iteration", () => {
        const ctx = new TestContext();
        const tree = ctx.createTree(n("Repeat", "r", { args: { count: 3 }, children: [probe("a")] }));
        assert.equal(tree.tick(), "success");
        assert.deepEqual(ctx.takeLog(), ["tick:a", "tick:a", "tick:a"]);

        tree.blackboard.set("a", "running");
        tree.tick();
        tree.blackboard.set("a", undefined);
        assert.equal(tree.tick(), "success");
        // 1 running tick, then the 1st iteration finishes and 2 more
        assert.deepEqual(ctx.takeLog(), ["tick:a", "tick:a", "tick:a", "tick:a"]);
    });

    it("ForEach sets the item and index, and resumes the running iteration", () => {
        const ctx = new TestContext();
        const tree = ctx.createTree(
            n("ForEach", "each", { input: ["arr"], output: ["item", "idx"], children: [probe("a")] }),
        );
        tree.blackboard.set("arr", [10, 20, 30]);
        tree.blackboard.set("a", "running");
        assert.equal(tree.tick(), "running");
        assert.equal(tree.blackboard.get("item"), 10);
        assert.equal(tree.blackboard.get("idx"), 0);
        tree.blackboard.set("a", undefined);
        assert.equal(tree.tick(), "success");
        assert.equal(ctx.takeLog().length, 4);
        // the outputs pass the loop variables to the child, and are cleared when it finishes
        // so they don't leak out of the loop (same as 1.x)
        assert.equal(tree.blackboard.get("item"), undefined);
    });

    it("Filter resumes from the running item", () => {
        const ctx = new TestContext();
        const tree = ctx.createTree(
            n("Filter", "filter", {
                input: ["arr"],
                output: ["item", "result"],
                children: [n("Check", "check", { args: { value: "item > 1" } })],
            }),
        );
        tree.blackboard.set("arr", [1, 2, 3]);
        assert.equal(tree.tick(), "success");
        assert.deepEqual(tree.blackboard.get("result"), [2, 3]);

        const tree2 = ctx.createTree(
            n("Filter", "filter", { input: ["arr"], output: ["item", "result"], children: [probe("a")] }),
        );
        tree2.blackboard.set("arr", [1, 2, 3]);
        tree2.blackboard.set("a", "running");
        assert.equal(tree2.tick(), "running");
        tree2.blackboard.set("a", undefined);
        assert.equal(tree2.tick(), "success");
        // item 1 is not filtered twice
        assert.deepEqual(tree2.blackboard.get("result"), [1, 2, 3]);
        assert.deepEqual(ctx.takeLog(), ["tick:a", "tick:a", "tick:a", "tick:a"]);
    });

    it("Once runs its child only once", () => {
        const ctx = new TestContext();
        const tree = ctx.createTree(n("Once", "once", { children: [probe("a")] }));
        tree.blackboard.set("a", "running");
        assert.equal(tree.tick(), "running");
        tree.blackboard.set("a", "failure");
        assert.equal(tree.tick(), "success");
        assert.equal(tree.tick(), "failure");
        assert.deepEqual(ctx.takeLog(), ["tick:a", "tick:a"]);
    });

    it("RetryUntilSuccess retries once per tick and stops at the max count", () => {
        const ctx = new TestContext();
        const tree = ctx.createTree(
            n("RetryUntilSuccess", "retry", { args: { count: 3 }, children: [probe("a")] }),
        );
        tree.blackboard.set("a", "failure");
        assert.equal(tree.tick(), "running");
        assert.equal(tree.tick(), "running");
        assert.equal(tree.tick(), "running");
        assert.equal(tree.tick(), "failure");
        assert.deepEqual(ctx.takeLog(), ["tick:a", "tick:a", "tick:a"]);

        tree.tick();
        tree.blackboard.set("a", "success");
        assert.equal(tree.tick(), "success");
    });

    it("RetryUntilSuccess retries immediately when a running try fails", () => {
        const ctx = new TestContext();
        const tree = ctx.createTree(
            n("RetryUntilSuccess", "retry", { args: { count: 3 }, children: [probe("a")] }),
        );
        tree.blackboard.set("a", "running");
        assert.equal(tree.tick(), "running");
        tree.blackboard.set("a", "failure");
        assert.equal(tree.tick(), "running");
        assert.deepEqual(ctx.takeLog(), ["tick:a", "tick:a", "tick:a"]);
    });

    it("RetryUntilFailure succeeds when the child fails", () => {
        const ctx = new TestContext();
        const tree = ctx.createTree(
            n("RetryUntilFailure", "retry", { args: { count: 2 }, children: [probe("a")] }),
        );
        assert.equal(tree.tick(), "running");
        assert.equal(tree.tick(), "running");
        assert.equal(tree.tick(), "failure");
        tree.blackboard.set("a", "failure");
        assert.equal(tree.tick(), "success");
    });

    it("Timeout fails and aborts the child when expired", () => {
        const ctx = new TestContext();
        const tree = ctx.createTree(n("Timeout", "t", { args: { time: 2 }, children: [probe("a")] }));
        tree.blackboard.set("a", "running");
        assert.equal(tree.tick(), "running");
        ctx.update(1);
        assert.equal(tree.tick(), "running");
        ctx.update(1);
        assert.equal(tree.tick(), "failure");
        assert.deepEqual(ctx.takeLog(), ["tick:a", "tick:a", "abort:a"]);
    });

    it("Assert returns error when the child fails", () => {
        const ctx = new TestContext();
        const tree = ctx.createTree(
            n("Assert", "assert", { args: { message: "oops" }, children: [probe("a", { args: { status: "failure" } })] }),
        );
        const { result, warn } = captureConsole(() => tree.tick());
        assert.equal(result, "error");
        assert.match(warn[0], /Assert#assert: oops/);
    });

    it("AlwaysRunning restarts its child after it finishes", () => {
        const ctx = new TestContext();
        const tree = ctx.createTree(n("AlwaysRunning", "r", { children: [probe("a")] }));
        assert.equal(tree.tick(), "running");
        assert.equal(tree.tick(), "running");
        assert.deepEqual(ctx.takeLog(), ["tick:a", "tick:a"]);
    });
});

describe("actions", () => {
    it("Wait succeeds after the time", () => {
        const ctx = new TestContext();
        const tree = ctx.createTree(n("Wait", "w", { args: { time: 2 } }));
        assert.equal(tree.tick(), "running");
        ctx.update(1);
        assert.equal(tree.tick(), "running");
        ctx.update(1);
        assert.equal(tree.tick(), "success");
    });

    it("WaitForEvent succeeds after the event and removes its listener", () => {
        const ctx = new TestContext();
        const tree = ctx.createTree(n("WaitForEvent", "w", { args: { event: "go" } }));
        assert.equal(tree.tick(), "running");
        assert.equal(ctx.listenerCount("go"), 1);
        assert.equal(tree.tick(), "running");
        assert.equal(ctx.listenerCount("go"), 1);
        ctx.dispatch("go");
        assert.equal(ctx.listenerCount("go"), 0);
        assert.equal(tree.tick(), "success");
    });

    it("Let outputs a fresh copy of the json value", () => {
        const ctx = new TestContext();
        const tree = ctx.createTree(n("Let", "let", { args: { value: { a: 1 } }, output: ["v"] }));
        tree.tick();
        const first = tree.blackboard.get<{ a: number }>("v")!;
        first.a = 2;
        tree.tick();
        assert.deepEqual(tree.blackboard.get("v"), { a: 1 });
        assert.notEqual(tree.blackboard.get("v"), first);
    });
});

describe("callbacks", () => {
    it("Delay ticks its child later and aborts it if running", () => {
        const ctx = new TestContext();
        const tree = ctx.createTree(n("Delay", "d", { args: { delay: 1 }, children: [probe("a")] }));
        tree.blackboard.set("a", "running");
        assert.equal(tree.tick(), "success");
        assert.deepEqual(ctx.takeLog(), []);
        ctx.update(1);
        assert.deepEqual(ctx.takeLog(), ["tick:a", "abort:a"]);
        assert.equal(tree.isRunning(tree.root!.children[0]), false);
    });

    it("Listen ticks its child on events and aborts it if running", () => {
        const ctx = new TestContext();
        const tree = ctx.createTree(n("Listen", "l", { args: { event: "hello" }, output: ["", "arg"], children: [probe("a")] }));
        assert.equal(tree.tick(), "success");
        tree.blackboard.set("a", "running");
        ctx.dispatch("hello", undefined, "world");
        assert.equal(tree.blackboard.get("arg"), "world");
        assert.deepEqual(ctx.takeLog(), ["tick:a", "abort:a"]);
        tree.clear();
        ctx.dispatch("hello", undefined, "world");
        assert.deepEqual(ctx.takeLog(), []);
    });

    it("Listen listens to a target from the input", () => {
        const ctx = new TestContext();
        const tree = ctx.createTree(
            n("Listen", "l", { args: { event: "hit" }, input: ["target"], output: ["who", "damage"], children: [probe("a")] }),
        );
        const target = { name: "t" };
        tree.blackboard.set("target", target);
        tree.tick();
        ctx.dispatch("hit", {}, 1);
        ctx.dispatch("hit", undefined, 1);
        assert.deepEqual(ctx.takeLog(), []);
        ctx.dispatch("hit", target, 5);
        assert.deepEqual(ctx.takeLog(), ["tick:a"]);
        assert.equal(tree.blackboard.get("who"), target);
        assert.equal(tree.blackboard.get("damage"), 5);
    });

    it("Listen listens to every target of an array", () => {
        const ctx = new TestContext();
        const tree = ctx.createTree(
            n("Listen", "l", { args: { event: "hit" }, input: ["targets"], output: ["who"], children: [probe("a")] }),
        );
        const [t1, t2] = [{}, {}];
        tree.blackboard.set("targets", [t1, t2]);
        tree.tick();
        ctx.dispatch("hit", t2);
        assert.equal(tree.blackboard.get("who"), t2);
        ctx.dispatch("hit", t1);
        assert.equal(tree.blackboard.get("who"), t1);
        assert.deepEqual(ctx.takeLog(), ["tick:a", "tick:a"]);
    });

    it("Listen listens to the events of the tree", () => {
        const ctx = new TestContext();
        const tree = ctx.createTree(
            n("Sequence", "seq", {
                children: [
                    n("AlwaysSuccess", "as", {
                        children: [
                            n("Once", "once", {
                                children: [
                                    n("Listen", "l", { args: { event: TreeEvent.TICKED_SUCCESS }, children: [probe("x")] }),
                                ],
                            }),
                        ],
                    }),
                    probe("a"),
                ],
            }),
        );
        tree.tick();
        tree.tick();
        assert.deepEqual(ctx.takeLog(), ["tick:a", "tick:x", "tick:a", "tick:x"]);

        // the target of a tree event is always the tree
        const tree2 = ctx.createTree(
            n("Listen", "l", { args: { event: TreeEvent.BEFORE_TICKED }, input: ["target"], children: [probe("y")] }),
        );
        tree2.blackboard.set("target", {});
        const { warn } = captureConsole(() => tree2.tick());
        assert.match(warn[0], /invalid target/);
        tree2.tick();
        assert.deepEqual(ctx.takeLog(), ["tick:y"]);
    });
});

describe("args", () => {
    it("json args are fresh copies every tick", () => {
        const ctx = new TestContext();
        const tree = ctx.createTree(n("ArgsSpy", "spy", { args: { value: { list: [] } } }));
        tree.tick();
        tree.tick();
        // each tick mutates its own copy
        assert.deepEqual(ctx.received, [{ list: [0] }, { list: [0] }]);
    });

    it("other object args are frozen", () => {
        const ctx = new TestContext();
        const tree = ctx.createTree(n("ArgsSpy", "spy", { args: { list: [1, 2] } }));
        const { result, error } = captureConsole(() => tree.tick());
        assert.equal(result, "exception");
        assert.match(error[0], /not extensible|read.only|frozen/i);
    });

    it("does not freeze the tree config", () => {
        const ctx = new TestContext();
        const tree = ctx.createTree(n("ArgsSpy", "spy", { args: { list: [1, 2] } }));
        assert.equal(Object.isFrozen(tree.root!.cfg.args.list), false);
    });
});

describe("args from inputs", () => {
    it("reads the arg from the input when the input is configured", () => {
        const ctx = new TestContext();
        const tree = ctx.createTree(n("Timeout", "t", { input: ["time"], args: { time: 100 }, children: [probe("a")] }));
        tree.blackboard.set("time", 1);
        tree.blackboard.set("a", "running");
        tree.tick();
        ctx.update(1);
        assert.equal(tree.tick(), "failure");
    });

    it("warns and uses the default value when an optional input is missing", () => {
        const ctx = new TestContext();
        const tree = ctx.createTree(n("Wait", "w", { input: ["time"] }));
        const { result, warn } = captureConsole(() => tree.tick());
        assert.equal(result, "running");
        assert.match(warn[0], /missing input 'time'/);
        assert.equal(tree.tick(), "success");
    });

    it("args not declared in the descriptor are json literals", () => {
        const ctx = new TestContext();
        const tree = ctx.createTree(probe("a", { args: { extra: { list: [1] } } }));
        const args = tree.root!.args as { extra: { list: number[] } };
        tree.tick();
        const first = args.extra;
        assert.equal(Object.isFrozen(first), false);
        first.list.push(2);
        tree.tick();
        assert.notEqual(args.extra, first);
        assert.deepEqual(args.extra, { list: [1] });
    });
});

describe("persistent state", () => {
    it("Once keeps its flag after an interrupt and resets it on clear", () => {
        const ctx = new TestContext();
        const tree = ctx.createTree(
            n("Sequence", "seq", {
                children: [n("AlwaysSuccess", "as", { children: [n("Once", "once", { children: [probe("x")] })] }), probe("a")],
            }),
        );
        tree.blackboard.set("a", "running");
        tree.tick();
        tree.interrupt();
        tree.tick();
        assert.deepEqual(ctx.takeLog(), ["tick:x", "tick:a", "abort:a", "tick:a"]);

        tree.clear();
        ctx.takeLog();
        tree.blackboard.set("a", "running");
        tree.tick();
        assert.deepEqual(ctx.takeLog(), ["tick:x", "tick:a"]);
    });

    it("interrupt removes the temp variables only", () => {
        const ctx = new TestContext();
        const tree = ctx.createTree(probe("a", { args: { status: "running" } }));
        const node = tree.root!;
        const temp = Blackboard.makeTempVar(node, "k");
        const privateVar = Blackboard.makePrivateVar(node, "k");
        tree.tick();
        tree.blackboard.set(temp, 1);
        tree.blackboard.set(privateVar, 2);
        tree.blackboard.set("v", 3);
        tree.interrupt();
        assert.deepEqual(tree.blackboard.values, { [privateVar]: 2, v: 3 });
    });
});

describe("tree", () => {
    it("dispatches the tree events", () => {
        const ctx = new TestContext();
        const tree = ctx.createTree(probe("a"));
        const events: string[] = [];
        for (const event of [
            TreeEvent.BEFORE_TICKED,
            TreeEvent.AFTER_TICKED,
            TreeEvent.TICKED_SUCCESS,
            TreeEvent.TICKED_FAILURE,
            TreeEvent.CLEANED,
        ]) {
            ctx.on(event, tree, () => events.push(event), "test");
        }
        tree.blackboard.set("a", "running");
        tree.tick();
        assert.deepEqual(events.splice(0), [TreeEvent.BEFORE_TICKED]);
        tree.blackboard.set("a", "success");
        tree.tick();
        assert.deepEqual(events.splice(0), [TreeEvent.AFTER_TICKED, TreeEvent.TICKED_SUCCESS]);
        tree.blackboard.set("a", "failure");
        tree.tick();
        assert.deepEqual(events.splice(0), [TreeEvent.BEFORE_TICKED, TreeEvent.AFTER_TICKED, TreeEvent.TICKED_FAILURE]);
        tree.clear();
        assert.deepEqual(events.splice(0), [TreeEvent.CLEANED]);
    });

    it("ticking the tree in a node is an exception", () => {
        const ctx = new TestContext();
        const tree = ctx.createTree(probe("a"));
        tree.root!.onTick = (t) => (t.tick(), "success");
        const { result, error } = captureConsole(() => tree.tick());
        assert.equal(result, "exception");
        assert.match(error[0], /already ticking: Probe#a/);
        assert.equal(tree.ticking, false);
    });

    it("exposes the owner, the root and the running node", () => {
        const ctx = new TestContext();
        const owner = { name: "unit" };
        const tree = new Tree(ctx, owner, ctx.createTree(probe("a")).path);
        assert.equal(tree.owner, owner);
        assert.equal(tree.ready, true);
        assert.equal(tree.root!.name, "Probe");
        tree.blackboard.set("a", "running");
        tree.tick();
        assert.equal(tree.runningNode, tree.root);
        tree.blackboard.set("a", "success");
        tree.tick();
        assert.equal(tree.runningNode, undefined);
    });
});
