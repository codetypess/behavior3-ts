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

    it("doesn't export the output left by the last run", () => {
        const ctx = new TestContext();
        // writes `target` only when `found` is passed in
        ctx.defineTree(
            "find",
            n("Selector", "sel", {
                children: [
                    n("Sequence", "hit", {
                        children: [
                            n("Check", "c", { args: { value: "found" } }),
                            letv("l", "target", "E"),
                        ],
                    }),
                    probe("none"),
                ],
            }),
        );
        const tree = ctx.createTree(
            runTree("rt", "find", { input: ["found"], output: ["target"] }),
        );
        tree.blackboard.set("found", true);
        assert.equal(tree.tick(), "success");
        assert.equal(tree.blackboard.get("target"), "E");
        // the caller consumes the result, the next run finds nothing
        tree.blackboard.set("target", undefined);
        tree.blackboard.set("found", false);
        assert.equal(tree.tick(), "success");
        assert.equal(tree.blackboard.get("target"), undefined);
    });

    it("passes an input which is also an output", () => {
        const { tree } = setup(
            n("Calculate", "inc", { args: { value: "n + 1" }, output: ["n"] }),
            (path) => runTree("rt", path, { input: ["n"], output: ["n"] }),
        );
        tree.blackboard.set("n", 1);
        tree.tick();
        assert.equal(tree.blackboard.get("n"), 2);
        tree.tick();
        assert.equal(tree.blackboard.get("n"), 3);
    });

    it("keeps the output written across the ticks of a run", () => {
        const { ctx, tree } = setup(
            seq("seq", letv("l", "result", 7), n("Wait", "w", { args: { time: 1 } })),
            (path) => runTree("rt", path, { output: ["result"] }),
        );
        assert.equal(tree.tick(), "running");
        ctx.update(1);
        assert.equal(tree.tick(), "success");
        assert.equal(tree.blackboard.get("result"), 7);
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

    it("is not allowed in a condition tree", () => {
        const ctx = new TestContext();
        ctx.defineTree(
            "sub",
            n("Listen", "listen", { args: { event: "hit" }, children: [probe("cb")] }),
        );
        assert.throws(
            () => ctx.createTree(probe("a", { conditions: [cond(runTree("rt", "sub"))] })),
            /RunTree#rt: 'RunTree' is deferred, not allowed in a condition tree/,
        );
        assert.throws(
            () =>
                ctx.createTree(
                    probe("a", {
                        conditions: [cond(n("Scope", "s", { children: [runTree("rt", "sub")] }))],
                    }),
                ),
            /'RunTree' is deferred, not allowed in a condition tree/,
        );
        assert.equal(ctx.listenerCount("hit"), 0);
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

describe("RunTree re-entered from a callback of the subtree", () => {
    /** The subtree listens `e` (in a Scope or not), the callback ticks the main tree. */
    const reenter = (inScope: boolean) => {
        const ctx = new TestContext();
        let main: Tree<TestContext, unknown> | undefined;
        const listen = n("BindListen", "bl", { args: { event: "e", key: "x" }, children: [probe("cb")] });
        ctx.defineTree(
            "sub",
            seq("seq", read("r", "x"), inScope ? n("Scope", "sc", { children: [listen] }) : listen),
        );
        const tree = (main = ctx.createTree(runTree("rt", "sub", { input: ["x"] })));
        tree.blackboard.set("x", 1);
        assert.equal(tree.tick(), "success");
        // the child of the callback ticks the main tree, whose RunTree comes back to the subtree
        const bindListen = ctx.trees["sub"].children[1];
        const callbackChild = (inScope ? bindListen.children[0] : bindListen).children[0];
        callbackChild.onTick = () => {
            ctx.log.push(`main=${main!.tick()}`);
            return "success";
        };
        tree.blackboard.set("x", 2);
        ctx.takeLog();
        return { ctx, tree };
    };

    for (const inScope of [true, false]) {
        it(`is an exception, the subtree is not touched${inScope ? " (in a Scope)" : ""}`, () => {
            const { ctx, tree } = reenter(inScope);
            const { error } = captureConsole(() => ctx.dispatch("e"));
            assert.deepEqual(ctx.takeLog(), ["cb:bl=1", "main=exception"]);
            assert.match(error[0], /->RunTree#rt: tree 'sub' is executing \(a callback or an abort\), it can't be run again/);
            assert.equal(error.length, 1);
            // runs normally after the callback, with the new input
            assert.equal(tree.tick(), "success");
            assert.deepEqual(ctx.takeLog(), ["read:r=2"]);
        });
    }
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

describe("load failure", () => {
    const settle = () => new Promise((resolve) => setImmediate(resolve));

    /** Runs `fn`, waits for the rejected loads to be handled, returns the console errors. */
    const loadErrors = async (fn: () => void) => {
        const errors: string[] = [];
        const old = console.error;
        console.error = (...args: unknown[]) => errors.push(args.map(String).join(" "));
        try {
            fn();
            await settle();
        } finally {
            console.error = old;
        }
        // only the messages of behavior3, the runtime may print its own warnings meanwhile
        return errors.filter((e) => e.startsWith("behavior3:"));
    };

    it("records the error of a failed load, the tree returns error", async () => {
        const ctx = new TestContext();
        ctx.defineTree("main", probe("a"));
        ctx.deferLoad("main");
        const tree = new Tree(ctx, {}, "main");
        assert.equal(tree.tick(), "failure");
        assert.equal(tree.loadError, undefined);
        const errors = await loadErrors(() => ctx.failLoad("main", new Error("not found")));
        assert.equal(errors.length, 1);
        assert.match(errors[0], /load tree 'main' failed: Error: not found/);
        assert.equal(tree.ready, false);
        assert.equal((tree.loadError as Error | undefined)?.message, "not found");
        assert.equal(tree.tick(), "error");
        assert.equal(tree.tick(), "error");
    });

    it("records a rejection which is not an Error", async () => {
        const ctx = new TestContext();
        ctx.loadTree = () => Promise.reject("gone");
        const errors: string[] = [];
        const tree = new Tree(ctx, {}, "main");
        await loadErrors(() => {}).then((e) => errors.push(...e));
        assert.equal(tree.loadError?.message, "gone");
        assert.match(errors[0], /load tree 'main' failed/);
    });

    it("still throws a synchronous error to the caller", () => {
        const ctx = new TestContext();
        ctx.loadTree = () => {
            throw new Error("bad config");
        };
        assert.throws(() => new Tree(ctx, {}, "main"), /bad config/);
    });

    it("returns error from RunTree without waiting for the timeout", async () => {
        const ctx = new TestContext();
        ctx.defineTree("sub", probe("a"));
        ctx.deferLoad("sub");
        const tree = ctx.createTree(runTree("rt", "sub", { timeout: 100 }));
        assert.equal(tree.tick(), "running");
        await loadErrors(() => ctx.failLoad("sub", new Error("not found")));
        const { result, warn } = captureConsole(() => tree.tick());
        assert.equal(result, "error");
        assert.match(warn[0], /load tree 'sub' failed/);
    });

    it("keeps the failed subtree until the caller is cleared", async () => {
        const ctx = new TestContext();
        ctx.defineTree("sub", probe("a"));
        ctx.deferLoad("sub");
        const tree = ctx.createTree(runTree("rt", "sub"));
        tree.tick();
        await loadErrors(() => ctx.failLoad("sub", new Error("not found")));
        captureConsole(() => {
            assert.equal(tree.tick(), "error");
            assert.equal(tree.tick(), "error");
        });
        assert.deepEqual(
            ctx.loads.filter((p) => p === "sub"),
            ["sub"],
        );
        // a new instance loads the tree again
        tree.clear();
        ctx.finishLoad("sub");
        assert.equal(tree.tick(), "success");
        assert.deepEqual(
            ctx.loads.filter((p) => p === "sub"),
            ["sub", "sub"],
        );
        assert.deepEqual(ctx.takeLog(), ["tick:a"]);
    });
});

describe("RunTree keep: false", () => {
    const runOnce = (
        id: string,
        path: string,
        opts: { input?: string[]; output?: string[] } = {},
    ) =>
        n("RunTree", id, {
            args: { path, keep: false },
            input: ["", ...(opts.input ?? [])],
            output: opts.output ?? [],
        });
    const loadsOf = (ctx: TestContext, path: string) => ctx.loads.filter((p) => p === path).length;

    it("starts every run from a clean subtree", () => {
        const { ctx, tree } = setup(
            seq(
                "seq",
                read("count", "count"),
                letv("l", "count", 1),
                n("Once", "once", { children: [probe("a")] }),
            ),
            (path) => runOnce("rt", path),
        );
        tree.tick();
        tree.tick();
        assert.deepEqual(ctx.takeLog(), [
            "read:count=undefined",
            "tick:a",
            "read:count=undefined",
            "tick:a",
        ]);
    });

    it("exports the output before clearing the subtree", () => {
        const { tree } = setup(letv("l", "result", 7), (path) =>
            runOnce("rt", path, { output: ["result"] }),
        );
        assert.equal(tree.tick(), "success");
        assert.equal(tree.blackboard.get("result"), 7);
    });

    it("removes the listeners of the subtree when the run ends", () => {
        const { ctx, tree } = setup(
            n("Listen", "listen", { args: { event: "hit" }, children: [probe("cb")] }),
            (path) => runOnce("rt", path),
        );
        tree.tick();
        assert.equal(ctx.listenerCount("hit"), 0);
        ctx.dispatch("hit");
        assert.deepEqual(ctx.takeLog(), []);
    });

    it("keeps the instance while the run is running", () => {
        const { ctx, tree } = setup(
            seq("seq", letv("l", "x", 1), n("Wait", "w", { args: { time: 1 } }), read("r", "x")),
            (path) => runOnce("rt", path),
        );
        assert.equal(tree.tick(), "running");
        ctx.update(1);
        assert.equal(tree.tick(), "success");
        assert.deepEqual(ctx.takeLog(), ["read:r=1"]);
    });

    it("reuses the instance for the same path, replaces it for another", () => {
        const ctx = new TestContext();
        ctx.defineTree("a", probe("pa"));
        ctx.defineTree("b", probe("pb"));
        const tree = ctx.createTree(n("RunTree", "rt", { args: { keep: false }, input: ["path"] }));
        for (const path of ["a", "a", "a", "b", "b", "a"]) {
            tree.blackboard.set("path", path);
            assert.equal(tree.tick(), "success");
        }
        assert.deepEqual(ctx.takeLog(), [
            "tick:pa",
            "tick:pa",
            "tick:pa",
            "tick:pb",
            "tick:pb",
            "tick:pa",
        ]);
        // a new instance loads the tree: a, then b, then a again
        assert.equal(loadsOf(ctx, "a"), 2);
        assert.equal(loadsOf(ctx, "b"), 1);
    });

    it("clears the subtree when the run is aborted", () => {
        const { ctx, tree } = setup(n("ClearSpy", "sub", { args: { status: "running" } }), (path) =>
            n("Timeout", "to", { args: { time: 1 }, children: [runOnce("rt", path)] }),
        );
        assert.equal(tree.tick(), "running");
        ctx.update(1);
        assert.equal(tree.tick(), "failure");
        assert.deepEqual(ctx.takeLog(), ["tick:sub", "abort:sub", "clear:sub"]);
    });

    it("clears the instance with the caller", () => {
        const { ctx, tree } = setup(n("ClearSpy", "sub", { args: { status: "running" } }), (path) =>
            runOnce("rt", path),
        );
        tree.tick();
        tree.clear();
        assert.deepEqual(ctx.takeLog(), ["tick:sub", "abort:sub", "clear:sub"]);
        // a new instance after the clear
        tree.tick();
        assert.equal(loadsOf(ctx, "sub"), 2);
    });

    it("keeps the instances by default", () => {
        const { ctx, tree } = setup(
            seq("seq", read("count", "count"), letv("l", "count", 1)),
            (path) => runTree("rt", path),
        );
        tree.tick();
        tree.tick();
        assert.deepEqual(ctx.takeLog(), ["read:count=undefined", "read:count=1"]);
    });
});
