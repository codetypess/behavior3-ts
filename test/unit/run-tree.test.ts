import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Tree } from "../../src/behavior3";
import { captureConsole, cond, n, NodeSpec, probe, TestContext } from "./helpers";

const read = (id: string, key: string, status?: string) => n("Read", id, { args: { key, status } });
const letv = (id: string, key: string, value: unknown) =>
    n("Let", id, { args: { value }, output: [key] });
const seq = (id: string, ...children: NodeSpec[]) => n("Sequence", id, { children });
const runTree = (
    id: string,
    path: string,
    opts: { input?: string[]; output?: string[]; timeout?: number } = {},
) =>
    n("RunTree", id, {
        args: { path, timeout: opts.timeout },
        input: ["", ...(opts.input ?? [])],
        output: opts.output ?? [],
    });

/** A context with the subtree `sub`, and a main tree running it. */
const setup = (sub: NodeSpec, main: (path: string) => NodeSpec = (path) => runTree("rt", path)) => {
    const ctx = new TestContext();
    ctx.defineTree("sub", sub);
    const tree = ctx.createTree(main("sub"));
    return { ctx, tree };
};

describe("RunTree data", () => {
    it("runs the subtree", () => {
        const { ctx, tree } = setup(seq("seq", probe("a"), probe("b")));
        assert.equal(tree.tick(), "success");
        assert.deepEqual(ctx.takeLog(), ["tick:a", "tick:b"]);
    });

    it("takes the path from the input", () => {
        const ctx = new TestContext();
        ctx.defineTree("sub", probe("a"));
        const tree = ctx.createTree(n("RunTree", "rt", { input: ["path"] }));
        tree.blackboard.set("path", "sub");
        assert.equal(tree.tick(), "success");
        assert.deepEqual(ctx.takeLog(), ["tick:a"]);
    });

    it("returns error without a path", () => {
        const ctx = new TestContext();
        const tree = ctx.createTree(n("RunTree", "rt", { input: ["path"] }));
        const { warn } = captureConsole(() => assert.equal(tree.tick(), "error"));
        assert.match(warn[0], /missing input 'path'/);

        const tree2 = ctx.createTree(n("RunTree", "rt"));
        const { warn: warn2 } = captureConsole(() => assert.equal(tree2.tick(), "error"));
        assert.match(warn2[0], /invalid tree path/);
    });

    it("isolates the subtree from the caller", () => {
        const { ctx, tree } = setup(seq("seq", read("hp", "hp"), read("mp", "mp")), (path) =>
            runTree("rt", path, { input: ["hp"] }),
        );
        tree.blackboard.set("hp", 10);
        tree.blackboard.set("mp", 5);
        tree.tick();
        assert.deepEqual(ctx.takeLog(), ["read:hp=10", "read:mp=undefined"]);
    });

    it("keeps the variables of the subtree inside", () => {
        const { tree } = setup(seq("seq", letv("l", "tmp", 1), letv("m", "hp", 0)), (path) =>
            runTree("rt", path, { input: ["hp"] }),
        );
        tree.blackboard.set("hp", 10);
        tree.tick();
        assert.equal(tree.blackboard.get("tmp"), undefined);
        assert.equal(tree.blackboard.get("hp"), 10);
    });

    it("exports the output on success", () => {
        const { tree } = setup(seq("seq", letv("l", "result", 7), letv("m", "tmp", 1)), (path) =>
            runTree("rt", path, { output: ["result"] }),
        );
        assert.equal(tree.tick(), "success");
        assert.equal(tree.blackboard.get("result"), 7);
        assert.equal(tree.blackboard.get("tmp"), undefined);
    });

    it("doesn't export on failure", () => {
        const { tree } = setup(
            seq("seq", letv("l", "result", 7), probe("p", { args: { status: "failure" } })),
            (path) => runTree("rt", path, { output: ["result"] }),
        );
        tree.blackboard.set("result", 1);
        assert.equal(tree.tick(), "failure");
        assert.equal(tree.blackboard.get("result"), 1);
    });

    it("doesn't export on error", () => {
        const { tree } = setup(
            seq("seq", letv("l", "result", 7), probe("p", { args: { status: "error" } })),
            (path) => runTree("rt", path, { output: ["result"] }),
        );
        assert.equal(tree.tick(), "error");
        assert.equal(tree.blackboard.get("result"), undefined);
    });

    it("leaves the caller's variable missing in the subtree", () => {
        const { tree } = setup(probe("a"), (path) => runTree("rt", path, { output: ["result"] }));
        tree.blackboard.set("result", 1);
        tree.tick();
        assert.equal(tree.blackboard.get("result"), 1);
    });

    it("passes the input by value on start", () => {
        const { ctx, tree } = setup(seq("seq", probe("p"), read("hp", "hp")), (path) =>
            runTree("rt", path, { input: ["hp", "p"] }),
        );
        tree.blackboard.set("hp", 10);
        tree.blackboard.set("p", "running");
        assert.equal(tree.tick(), "running");
        tree.blackboard.set("hp", 20);
        assert.equal(tree.tick(), "running");
        // the subtree has its own `p`, set to success in the caller doesn't reach it
        tree.blackboard.set("p", "success");
        assert.equal(tree.tick(), "running");
        assert.deepEqual(ctx.takeLog(), ["tick:p", "tick:p", "tick:p"]);
    });

    it("passes the input again on the next run", () => {
        const { ctx, tree } = setup(read("hp", "hp"), (path) =>
            runTree("rt", path, { input: ["hp"] }),
        );
        tree.blackboard.set("hp", 10);
        tree.tick();
        tree.blackboard.set("hp", 20);
        tree.tick();
        tree.blackboard.set("hp", undefined);
        tree.tick();
        // an undefined input deletes the value left by the last run
        assert.deepEqual(ctx.takeLog(), ["read:hp=10", "read:hp=20", "read:hp=undefined"]);
    });

    it("writes the output into the scope of the caller", () => {
        const { ctx, tree } = setup(letv("l", "target", 3), (path) =>
            n("Scope", "s", {
                output: ["damage"],
                children: [
                    seq(
                        "seq",
                        runTree("rt", path, { output: ["target"] }),
                        n("Calculate", "calc", {
                            args: { value: "target * 2" },
                            output: ["damage"],
                        }),
                        read("r", "target"),
                    ),
                ],
            }),
        );
        tree.tick();
        assert.deepEqual(ctx.takeLog(), ["read:r=3"]);
        assert.equal(tree.blackboard.get("target"), undefined);
        assert.equal(tree.blackboard.get("damage"), 6);
    });

    it("exports to the caller from a condition tree with a Scope root", () => {
        const { ctx, tree } = setup(letv("l", "target", 3), (path) =>
            n("Sequence", "guarded", {
                conditions: [
                    cond(
                        n("Scope", "s", {
                            output: ["target"],
                            children: [runTree("rt", path, { output: ["target"] })],
                        }),
                    ),
                ],
                children: [read("r", "target")],
            }),
        );
        assert.equal(tree.tick(), "success");
        assert.deepEqual(ctx.takeLog(), ["read:r=3"]);
    });

    it("drops the output in a condition tree without a Scope root", () => {
        const { tree } = setup(letv("l", "target", 3), (path) =>
            probe("a", { conditions: [cond(runTree("rt", path, { output: ["target"] }))] }),
        );
        assert.equal(tree.tick(), "success");
        assert.equal(tree.blackboard.get("target"), undefined);
    });
});

describe("RunTree instance", () => {
    it("reuses the subtree instance", () => {
        const { ctx, tree } = setup(
            seq(
                "seq",
                read("count", "count"),
                letv("l", "count", 1),
                n("Once", "once", { children: [probe("a")] }),
            ),
        );
        tree.tick();
        tree.tick();
        // the blackboard and Once of the instance are kept between runs
        assert.deepEqual(ctx.takeLog(), ["read:count=undefined", "tick:a", "read:count=1"]);
    });

    it("has an instance for every node", () => {
        const { ctx, tree } = setup(
            seq("seq", read("count", "count"), letv("l", "count", 1)),
            (path) => seq("main", runTree("rt1", path), runTree("rt2", path)),
        );
        tree.tick();
        assert.deepEqual(ctx.takeLog(), ["read:count=undefined", "read:count=undefined"]);
    });

    it("has an instance for every path", () => {
        const ctx = new TestContext();
        ctx.defineTree("sub1", seq("seq", read("count", "count"), letv("l", "count", 1)));
        ctx.defineTree("sub2", seq("seq", read("count", "count"), letv("l", "count", 1)));
        const tree = ctx.createTree(n("RunTree", "rt", { input: ["path"] }));
        tree.blackboard.set("path", "sub1");
        tree.tick();
        tree.blackboard.set("path", "sub2");
        tree.tick();
        tree.blackboard.set("path", "sub1");
        tree.tick();
        assert.deepEqual(ctx.takeLog(), [
            "read:count=undefined",
            "read:count=undefined",
            "read:count=1",
        ]);
    });

    it("has an instance for every unit", () => {
        const ctx = new TestContext();
        ctx.defineTree("sub", seq("seq", read("count", "count"), letv("l", "count", 1)));
        ctx.defineTree("main", runTree("rt", "sub"));
        // the units share the nodes of the main tree
        const tree1 = new Tree(ctx, {}, "main");
        const tree2 = new Tree(ctx, {}, "main");
        assert.equal(tree1.root, tree2.root);
        tree1.tick();
        tree2.tick();
        tree1.tick();
        assert.deepEqual(ctx.takeLog(), [
            "read:count=undefined",
            "read:count=undefined",
            "read:count=1",
        ]);
    });

    it("runs the subtree with the owner of the caller", () => {
        const ctx = new TestContext();
        ctx.defineTree("sub", probe("a"));
        const tree = ctx.createTree(runTree("rt", "sub"));
        tree.tick();
        // the subtree is reachable through the private var of the node
        const subtrees = Object.values(tree.blackboard.values).find((v) => v instanceof Map) as Map<
            string,
            typeof tree
        >;
        assert.equal(subtrees.get("sub")!.owner, tree.owner);
    });

    it("runs a nested RunTree", () => {
        const ctx = new TestContext();
        ctx.defineTree("leaf", letv("l", "result", "leaf"));
        ctx.defineTree("middle", runTree("rt", "leaf", { output: ["result"] }));
        const tree = ctx.createTree(runTree("rt", "middle", { output: ["result"] }));
        assert.equal(tree.tick(), "success");
        assert.equal(tree.blackboard.get("result"), "leaf");
    });

    it("runs a recursive tree in a new instance for every level", () => {
        const ctx = new TestContext();
        ctx.defineTree(
            "rec",
            n("Selector", "sel", {
                children: [
                    seq(
                        "done",
                        n("Check", "k", { args: { value: "depth >= 3" } }),
                        letv("l", "result", "done"),
                    ),
                    seq(
                        "deeper",
                        n("Calculate", "calc", { args: { value: "depth + 1" }, output: ["depth"] }),
                        runTree("rt", "rec", { input: ["depth"], output: ["result"] }),
                        n("Calculate", "count", { args: { value: "depth" }, output: ["result"] }),
                    ),
                ],
            }),
        );
        const tree = ctx.createTree(runTree("rt", "rec", { input: ["depth"], output: ["result"] }));
        tree.blackboard.set("depth", 0);
        assert.equal(tree.tick(), "success");
        // the outermost level sets result to its depth after the inner levels return
        assert.equal(tree.blackboard.get("result"), 1);
    });
});

describe("RunTree lifecycle", () => {
    it("keeps running across ticks", () => {
        const { ctx, tree } = setup(
            seq("seq", probe("a"), n("Wait", "w", { args: { time: 2 } }), probe("b")),
        );
        assert.equal(tree.tick(), "running");
        ctx.update(1);
        assert.equal(tree.tick(), "running");
        ctx.update(1);
        assert.equal(tree.tick(), "success");
        assert.deepEqual(ctx.takeLog(), ["tick:a", "tick:b"]);
    });

    it("aborts the subtree when preempted", () => {
        const { ctx, tree } = setup(seq("seq", read("r", "x", "running")), (path) =>
            n("PrioritySelector", "sel", {
                children: [
                    probe("flee", { conditions: [cond(probe("lowHp"), "lower")] }),
                    runTree("rt", path, { input: ["x"] }),
                ],
            }),
        );
        tree.blackboard.set("lowHp", "failure");
        tree.blackboard.set("x", 1);
        assert.equal(tree.tick(), "running");
        tree.blackboard.set("lowHp", "success");
        assert.equal(tree.tick(), "success");
        assert.deepEqual(ctx.takeLog(), [
            "tick:lowHp",
            "read:r=1",
            "tick:lowHp",
            "abort:r=1",
            "tick:flee",
        ]);
    });

    it("starts the subtree again after being aborted", () => {
        const { ctx, tree } = setup(seq("seq", probe("a"), read("r", "x", "running")), (path) =>
            n("Sequence", "main", {
                conditions: [cond(probe("ok"), "self")],
                children: [runTree("rt", path)],
            }),
        );
        tree.tick();
        tree.blackboard.set("ok", "failure");
        assert.equal(tree.tick(), "failure");
        tree.blackboard.set("ok", "success");
        tree.tick();
        assert.deepEqual(ctx.takeLog(), [
            "tick:ok",
            "tick:a",
            "read:r=undefined",
            "tick:ok",
            "abort:r=undefined",
            "tick:ok",
            "tick:a",
            "read:r=undefined",
        ]);
    });

    it("aborts the subtree when the caller is interrupted", () => {
        const { ctx, tree } = setup(read("r", "x", "running"));
        tree.tick();
        tree.interrupt();
        assert.equal(tree.status, "interrupted");
        assert.deepEqual(ctx.takeLog(), ["read:r=undefined", "abort:r=undefined"]);
    });

    it("clears the subtree with the caller", () => {
        const { ctx, tree } = setup(
            seq(
                "seq",
                n("Once", "once", {
                    children: [
                        n("Listen", "listen", { args: { event: "hit" }, children: [probe("hit")] }),
                    ],
                }),
                letv("l", "count", 1),
            ),
        );
        tree.tick();
        assert.equal(ctx.listenerCount("hit"), 1);
        ctx.dispatch("hit");
        assert.deepEqual(ctx.takeLog(), ["tick:hit"]);
        tree.clear();
        assert.equal(ctx.listenerCount("hit"), 0);
        ctx.dispatch("hit");
        assert.deepEqual(ctx.takeLog(), []);
        assert.deepEqual(Object.keys(tree.blackboard.values), []);
        // a new instance after clear: Once and Listen run again
        tree.tick();
        assert.equal(ctx.listenerCount("hit"), 1);
        tree.clear();
        tree.clear();
        assert.equal(ctx.listenerCount("hit"), 0);
    });

    it("clears the timers of the subtree with the caller", () => {
        const { ctx, tree } = setup(
            n("Delay", "delay", { args: { delay: 1 }, children: [probe("later")] }),
        );
        tree.tick();
        tree.clear();
        ctx.update(2);
        assert.deepEqual(ctx.takeLog(), []);
    });

    it("clears the nested subtrees", () => {
        const ctx = new TestContext();
        ctx.defineTree(
            "leaf",
            n("Listen", "listen", { args: { event: "hit" }, children: [probe("hit")] }),
        );
        ctx.defineTree("middle", runTree("rt", "leaf"));
        const tree = ctx.createTree(runTree("rt", "middle"));
        tree.tick();
        assert.equal(ctx.listenerCount("hit"), 1);
        tree.clear();
        assert.equal(ctx.listenerCount("hit"), 0);
    });

    it("syncs the debug flag", () => {
        const { tree } = setup(probe("a"));
        tree.debug = true;
        const { debug } = captureConsole(() => tree.tick());
        assert.ok(debug.some((v) => v.includes("debug ai: sub")));
        tree.debug = false;
        const { debug: debug2 } = captureConsole(() => tree.tick());
        assert.ok(!debug2.some((v) => v.includes("debug ai: sub")));
    });
});

describe("RunTree results", () => {
    it("turns an exception of the subtree into error", () => {
        const { tree } = setup(seq("seq", letv("l", "result", 1), n("Throw", "t")), (path) =>
            runTree("rt", path, { output: ["result"] }),
        );
        const { result, warn, error } = captureConsole(() => tree.tick());
        assert.equal(result, "error");
        assert.match(error[0], /boom/);
        assert.match(warn[0], /tree 'sub' threw an exception/);
        assert.equal(tree.status, "error");
        assert.equal(tree.blackboard.get("result"), undefined);
    });

    it("doesn't interrupt the caller on an exception of the subtree", () => {
        const { ctx, tree } = setup(n("Throw", "t"), (path) =>
            seq(
                "main",
                n("AlwaysSuccess", "as", {
                    children: [n("ErrorToFailure", "etf", { children: [runTree("rt", path)] })],
                }),
                probe("next"),
            ),
        );
        const { result } = captureConsole(() => tree.tick());
        assert.equal(result, "success");
        assert.equal(tree.status, "success");
        assert.deepEqual(ctx.takeLog(), ["tick:next"]);
    });

    it("returns failure when the subtree interrupts itself", () => {
        const { tree } = setup(n("Interrupt", "i"));
        assert.equal(tree.tick(), "failure");
    });

    it("returns the status of the subtree", () => {
        for (const status of ["success", "failure", "error"] as const) {
            const { tree } = setup(probe("a", { args: { status } }));
            assert.equal(tree.tick(), status);
        }
    });
});

describe("RunTree loading", () => {
    const deferred = (timeout?: number) => {
        const ctx = new TestContext();
        ctx.defineTree("sub", seq("seq", read("hp", "hp"), letv("l", "result", 1)));
        ctx.deferLoad("sub");
        const tree = ctx.createTree(
            runTree("rt", "sub", { input: ["hp"], output: ["result"], timeout }),
        );
        return { ctx, tree };
    };

    it("returns running while loading and runs once loaded", () => {
        const { ctx, tree } = deferred();
        tree.blackboard.set("hp", 10);
        assert.equal(tree.tick(), "running");
        ctx.update(100);
        assert.equal(tree.tick(), "running");
        tree.blackboard.set("hp", 20);
        ctx.finishLoad("sub");
        assert.equal(tree.tick(), "success");
        // the input is passed when the subtree starts, not when RunTree starts
        assert.deepEqual(ctx.takeLog(), ["read:hp=20"]);
        assert.equal(tree.blackboard.get("result"), 1);
    });

    it("waits forever without timeout", () => {
        const { ctx, tree } = deferred();
        for (let i = 0; i < 10; i++) {
            ctx.update(1000);
            assert.equal(tree.tick(), "running");
        }
    });

    it("returns error when loading times out", () => {
        const { ctx, tree } = deferred(2);
        assert.equal(tree.tick(), "running");
        ctx.update(1);
        assert.equal(tree.tick(), "running");
        ctx.update(1);
        const { result, warn } = captureConsole(() => tree.tick());
        assert.equal(result, "error");
        assert.match(warn[0], /load tree 'sub' timeout/);
    });

    it("counts the timeout from every run", () => {
        const { ctx, tree } = deferred(2);
        tree.tick();
        ctx.update(2);
        captureConsole(() => tree.tick());
        assert.equal(tree.tick(), "running");
        ctx.update(1);
        assert.equal(tree.tick(), "running");
        ctx.finishLoad("sub");
        assert.equal(tree.tick(), "success");
    });

    it("runs at once when loaded before the timeout", () => {
        const { ctx, tree } = deferred(2);
        ctx.finishLoad("sub");
        assert.equal(tree.tick(), "success");
    });

    it("is aborted while loading without touching the subtree", () => {
        const { ctx, tree } = deferred();
        tree.tick();
        tree.interrupt();
        assert.equal(tree.status, "interrupted");
        ctx.finishLoad("sub");
        assert.equal(tree.tick(), "success");
    });
});

describe("Node.onClear", () => {
    const spy = (id: string, args: Record<string, unknown> = {}) => n("ClearSpy", id, { args });

    it("is called on every node, including the condition trees", () => {
        const ctx = new TestContext();
        const tree = ctx.createTree(
            seq(
                "seq",
                spy("a", { status: "success" }),
                n("Sequence", "inner", { conditions: [cond(spy("c"))], children: [spy("b")] }),
            ),
        );
        tree.tick();
        ctx.takeLog();
        tree.clear();
        assert.deepEqual(ctx.takeLog(), ["clear:a", "clear:c", "clear:b"]);
    });

    it("is called after the running nodes are aborted, before the blackboard is cleared", () => {
        const ctx = new TestContext();
        const tree = ctx.createTree(spy("a", { status: "running", key: "hp" }));
        tree.blackboard.set("hp", 1);
        tree.tick();
        ctx.takeLog();
        tree.clear();
        assert.deepEqual(ctx.takeLog(), ["abort:a", "clear:a=1"]);
        assert.equal(tree.blackboard.get("hp"), undefined);
    });

    it("is called even if the tree is not ticked", () => {
        const ctx = new TestContext();
        const tree = ctx.createTree(spy("a"));
        tree.clear();
        assert.deepEqual(ctx.takeLog(), ["clear:a"]);
    });

    it("is not called when the tree is not loaded", () => {
        const ctx = new TestContext();
        ctx.defineTree("lazy", spy("a"));
        ctx.deferLoad("lazy");
        const tree = new Tree(ctx, {}, "lazy");
        assert.equal(tree.ready, false);
        tree.clear();
        assert.deepEqual(ctx.takeLog(), []);
    });

    it("keeps calling the others when one throws", () => {
        const ctx = new TestContext();
        const tree = ctx.createTree(seq("seq", spy("a", { throw: true }), spy("b")));
        const { error } = captureConsole(() => tree.clear());
        assert.match(error[0], /clear boom/);
        assert.deepEqual(ctx.takeLog(), ["clear:a", "clear:b"]);
    });

    it("is called on every clear", () => {
        const ctx = new TestContext();
        const tree = ctx.createTree(spy("a"));
        tree.clear();
        tree.clear();
        assert.deepEqual(ctx.takeLog(), ["clear:a", "clear:a"]);
    });
});
