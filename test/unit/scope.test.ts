import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Blackboard, SKIP, TreeEvent } from "../../src/behavior3";
import { captureConsole, cond, n, NodeSpec, probe, TestContext } from "./helpers";

const read = (id: string, key: string, status?: string) => n("Read", id, { args: { key, status } });
const own = (id: string, key: string) => n("Own", id, { args: { key } });
const write = (id: string, key: string, value?: unknown) =>
    n("Write", id, { args: { key, value } });
const letv = (id: string, key: string, value: unknown) =>
    n("Let", id, { args: { value }, output: [key] });
const seq = (id: string, ...children: NodeSpec[]) => n("Sequence", id, { children });
const scope = (id: string, child: NodeSpec, output: string[] = []) =>
    n("Scope", id, { output, children: [child] });

describe("Blackboard overlay", () => {
    const makeRoot = () => new TestContext().createTree(probe("a")).blackboard;

    it("reads the outer variables and writes its own", () => {
        const root = makeRoot();
        root.set("hp", 100);
        const inner = root.fork();
        assert.equal(inner.get("hp"), 100);
        assert.equal(inner.hasOwn("hp"), false);
        inner.set("hp", 50);
        inner.set("mp", 1);
        assert.equal(inner.get("hp"), 50);
        assert.equal(inner.hasOwn("hp"), true);
        assert.equal(root.get("hp"), 100);
        assert.equal(root.get("mp"), undefined);
        assert.equal(inner.parent, root);
        assert.equal(root.parent, undefined);
    });

    it("shadows the outer variable when cleared in the overlay", () => {
        const root = makeRoot();
        root.set("hp", 100);
        const inner = root.fork();
        inner.set("hp", null);
        assert.equal(inner.get("hp"), undefined);
        assert.equal(inner.hasOwn("hp"), true);
        assert.equal(root.get("hp"), 100);
        inner.set("hp", undefined);
        assert.equal(inner.get("hp"), undefined);
        assert.equal(root.get("hp"), 100);
    });

    it("deletes the variable in the root blackboard", () => {
        const root = makeRoot();
        root.set("hp", 100);
        root.set("hp", null);
        assert.equal(root.hasOwn("hp"), false);
        assert.deepEqual(Object.keys(root.values), []);
    });

    it("reads the current outer value, not a snapshot", () => {
        const root = makeRoot();
        const inner = root.fork().fork();
        root.set("hp", 1);
        assert.equal(inner.get("hp"), 1);
        root.set("hp", 2);
        assert.equal(inner.get("hp"), 2);
        root.set("hp", undefined);
        assert.equal(inner.get("hp"), undefined);
    });

    it("finds the nearest layer in a chain", () => {
        const root = makeRoot();
        root.set("a", "root");
        root.set("b", "root");
        const middle = root.fork();
        middle.set("a", "middle");
        const inner = middle.fork();
        assert.equal(inner.get("a"), "middle");
        assert.equal(inner.get("b"), "root");
        inner.set("b", "inner");
        assert.equal(middle.get("b"), "root");
    });

    it("keeps the private vars and temp vars in the root blackboard", () => {
        const ctx = new TestContext();
        const tree = ctx.createTree(probe("a"));
        const root = tree.blackboard;
        const inner = root.fork().fork();
        const privateVar = Blackboard.makePrivateVar(tree.root!, "k");
        const tempVar = Blackboard.makeTempVar(tree.root!, "k");
        inner.set(privateVar, 1);
        inner.set(tempVar, 2);
        assert.equal(root.get(privateVar), 1);
        assert.equal(root.get(tempVar), 2);
        assert.equal(inner.hasOwn(privateVar), false);
        assert.equal(inner.get(privateVar), 1);
        inner.set(privateVar, undefined);
        assert.equal(root.hasOwn(privateVar), false);
    });

    it("reads the outer variable again after unset", () => {
        const root = makeRoot();
        root.set("hp", 100);
        const inner = root.fork();
        inner.unset("hp");
        assert.equal(inner.hasOwn("hp"), false);
        inner.set("hp", 50);
        inner.unset("hp");
        assert.equal(inner.hasOwn("hp"), false);
        assert.equal(inner.get("hp"), 100);
        root.set("hp", 7);
        assert.equal(inner.get("hp"), 7);
        root.unset("hp");
        assert.equal(root.hasOwn("hp"), false);
        assert.equal(inner.get("hp"), undefined);
    });

    it("evaluates expressions with the outer variables", () => {
        const root = makeRoot();
        root.set("hp", 10);
        const inner = root.fork();
        inner.set("mp", 5);
        assert.equal(inner.eval("hp + mp"), 15);
    });

    it("clears in place, the overlays stay valid", () => {
        const root = makeRoot();
        root.set("hp", 1);
        const values = root.values;
        const inner = root.fork();
        root.clear();
        assert.equal(root.values, values);
        assert.equal(inner.get("hp"), undefined);
        root.set("hp", 2);
        assert.equal(inner.get("hp"), 2);
    });

    it("clears only its own variables in an overlay", () => {
        const root = makeRoot();
        root.set("hp", 1);
        const inner = root.fork();
        inner.set("mp", 2);
        inner.clear();
        assert.equal(inner.get("mp"), undefined);
        assert.equal(inner.get("hp"), 1);
    });

    it("reads the outer values directly until the first write", () => {
        const root = makeRoot();
        root.set("hp", 1);
        const inner = root.fork();
        assert.equal(inner.values, root.values);
        assert.equal(inner.hasOwn("hp"), false);
        inner.clear();
        assert.equal(root.get("hp"), 1);
        inner.set("mp", 2);
        assert.notEqual(inner.values, root.values);
        assert.equal(Object.getPrototypeOf(inner.values), root.values);
    });

    it("sees the later writes of an outer overlay created after the inner one", () => {
        const root = makeRoot();
        const middle = root.fork();
        const inner = middle.fork();
        // the inner write creates the values of middle first
        inner.set("a", 1);
        middle.set("b", 2);
        root.set("c", 3);
        assert.equal(inner.get("b"), 2);
        assert.equal(inner.get("c"), 3);
        assert.equal(middle.get("a"), undefined);
        assert.equal(root.get("b"), undefined);
    });

    it("sees the writes of an outer overlay made before the inner one writes", () => {
        const root = makeRoot();
        const middle = root.fork();
        const inner = middle.fork();
        assert.equal(inner.get("b"), undefined);
        middle.set("b", 2);
        assert.equal(inner.get("b"), 2);
        inner.set("a", 1);
        middle.set("b", 3);
        assert.equal(inner.get("b"), 3);
    });
});

describe("Scope node", () => {
    it("reads the outer variables", () => {
        const ctx = new TestContext();
        const tree = ctx.createTree(scope("s", read("r", "hp")));
        tree.blackboard.set("hp", 100);
        assert.equal(tree.tick(), "success");
        assert.deepEqual(ctx.takeLog(), ["read:r=100"]);
    });

    it("keeps the writes inside the scope", () => {
        const ctx = new TestContext();
        const tree = ctx.createTree(
            seq(
                "seq",
                scope("s", seq("in", letv("l", "x", 1), write("w", "y", 2), read("r", "x"))),
                read("out", "x"),
            ),
        );
        assert.equal(tree.tick(), "success");
        assert.deepEqual(ctx.takeLog(), ["read:r=1", "read:out=undefined"]);
        assert.deepEqual(Object.keys(tree.blackboard.values), []);
    });

    it("shadows the outer variable with the same name", () => {
        const ctx = new TestContext();
        const tree = ctx.createTree(
            seq(
                "seq",
                scope("s", seq("in", letv("l", "hp", 1), read("r", "hp"))),
                read("out", "hp"),
            ),
        );
        tree.blackboard.set("hp", 100);
        tree.tick();
        assert.deepEqual(ctx.takeLog(), ["read:r=1", "read:out=100"]);
        assert.equal(tree.blackboard.get("hp"), 100);
    });

    it("hides the outer variable cleared in the scope", () => {
        const ctx = new TestContext();
        const tree = ctx.createTree(
            seq("seq", scope("s", seq("in", write("w", "hp", null), read("r", "hp")))),
        );
        tree.blackboard.set("hp", 100);
        tree.tick();
        assert.deepEqual(ctx.takeLog(), ["read:r=undefined"]);
        assert.equal(tree.blackboard.get("hp"), 100);
    });

    it("exports the output on success", () => {
        const ctx = new TestContext();
        const tree = ctx.createTree(
            scope("s", seq("in", letv("l", "x", 1), letv("t", "tmp", 2)), ["x"]),
        );
        assert.equal(tree.tick(), "success");
        assert.equal(tree.blackboard.get("x"), 1);
        assert.equal(tree.blackboard.get("tmp"), undefined);
    });

    it("overwrites the outer variable when exporting", () => {
        const ctx = new TestContext();
        const tree = ctx.createTree(scope("s", letv("l", "hp", 1), ["hp"]));
        tree.blackboard.set("hp", 100);
        tree.tick();
        assert.equal(tree.blackboard.get("hp"), 1);
    });

    it("doesn't export on failure", () => {
        const ctx = new TestContext();
        const tree = ctx.createTree(
            scope("s", seq("in", letv("l", "x", 1), probe("p", { args: { status: "failure" } })), [
                "x",
            ]),
        );
        tree.blackboard.set("x", 100);
        assert.equal(tree.tick(), "failure");
        assert.equal(tree.blackboard.get("x"), 100);
    });

    it("doesn't export on error", () => {
        const ctx = new TestContext();
        const tree = ctx.createTree(
            scope("s", seq("in", letv("l", "x", 1), probe("p", { args: { status: "error" } })), [
                "x",
            ]),
        );
        assert.equal(tree.tick(), "error");
        assert.equal(tree.blackboard.get("x"), undefined);
    });

    it("leaves the outer variable which is not written in the scope", () => {
        const ctx = new TestContext();
        const tree = ctx.createTree(scope("s", probe("p"), ["x"]));
        tree.blackboard.set("x", 100);
        tree.tick();
        assert.equal(tree.blackboard.get("x"), 100);
        assert.equal(tree.blackboard.hasOwn("x"), true);
    });

    it("deletes the outer variable cleared in the scope", () => {
        const ctx = new TestContext();
        const tree = ctx.createTree(scope("s", write("w", "x", null), ["x"]));
        tree.blackboard.set("x", 100);
        tree.tick();
        assert.equal(tree.blackboard.hasOwn("x"), false);
    });

    it("doesn't export while running", () => {
        const ctx = new TestContext();
        const tree = ctx.createTree(scope("s", seq("in", letv("l", "x", 1), probe("p")), ["x"]));
        tree.blackboard.set("p", "running");
        assert.equal(tree.tick(), "running");
        assert.equal(tree.blackboard.get("x"), undefined);
    });

    it("keeps the scope while running across ticks", () => {
        const ctx = new TestContext();
        const tree = ctx.createTree(
            scope(
                "s",
                seq(
                    "in",
                    n("Once", "once", { children: [letv("l", "x", 1)] }),
                    probe("p"),
                    read("r", "x"),
                ),
                ["x"],
            ),
        );
        tree.blackboard.set("p", "running");
        assert.equal(tree.tick(), "running");
        assert.equal(tree.tick(), "running");
        tree.blackboard.set("p", "success");
        assert.equal(tree.tick(), "success");
        assert.deepEqual(ctx.takeLog(), ["tick:p", "tick:p", "tick:p", "read:r=1"]);
        assert.equal(tree.blackboard.get("x"), 1);
    });

    it("starts a fresh scope on every run", () => {
        const ctx = new TestContext();
        const tree = ctx.createTree(scope("s", seq("in", read("r", "x"), letv("l", "x", 1))));
        tree.tick();
        tree.tick();
        assert.deepEqual(ctx.takeLog(), ["read:r=undefined", "read:r=undefined"]);
    });

    it("evaluates its own conditions in the outer scope", () => {
        const ctx = new TestContext();
        const tree = ctx.createTree(
            n("Scope", "s", {
                conditions: [cond(read("c", "x"))],
                children: [seq("in", letv("l", "x", 1), probe("p"))],
            }),
        );
        tree.blackboard.set("p", "running");
        tree.tick();
        tree.tick();
        // x of the scope is not visible to its conditions
        assert.deepEqual(ctx.takeLog(), ["read:c=undefined", "tick:p", "tick:p"]);
    });

    it("exports through nested scopes", () => {
        const ctx = new TestContext();
        const tree = ctx.createTree(
            scope(
                "outer",
                seq(
                    "seq",
                    scope("inner", letv("l", "x", 1), ["x"]),
                    read("r", "x"),
                    letv("m", "y", 2),
                ),
                ["x"],
            ),
        );
        tree.tick();
        assert.deepEqual(ctx.takeLog(), ["read:r=1"]);
        assert.equal(tree.blackboard.get("x"), 1);
        assert.equal(tree.blackboard.get("y"), undefined);
    });

    it("doesn't copy an outer value into the middle scope", () => {
        const ctx = new TestContext();
        const tree = ctx.createTree(
            scope(
                "outer",
                seq("seq", scope("inner", probe("p"), ["hp"]), own("o", "hp"), read("r", "hp")),
            ),
        );
        tree.blackboard.set("hp", 100);
        tree.tick();
        assert.deepEqual(ctx.takeLog(), ["tick:p", "own:o=false", "read:r=100"]);
    });

    it("aborts the children in the scope when preempted", () => {
        const ctx = new TestContext();
        const tree = ctx.createTree(
            n("PrioritySelector", "sel", {
                children: [
                    probe("flee", { conditions: [cond(probe("lowHp"), "lower")] }),
                    scope("s", seq("in", letv("l", "x", 1), read("r", "x", "running"))),
                ],
            }),
        );
        tree.blackboard.set("lowHp", "failure");
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
        assert.equal(tree.blackboard.get("x"), undefined);
    });

    it("aborts the children in the scope when its self condition fails", () => {
        const ctx = new TestContext();
        const tree = ctx.createTree(
            n("Scope", "s", {
                conditions: [cond(probe("ok"), "self")],
                children: [seq("in", letv("l", "x", 1), read("r", "x", "running"))],
            }),
        );
        assert.equal(tree.tick(), "running");
        tree.blackboard.set("ok", "failure");
        assert.equal(tree.tick(), "failure");
        assert.deepEqual(ctx.takeLog(), ["tick:ok", "read:r=1", "tick:ok", "abort:r=1"]);
    });

    it("aborts the children in the scope when the tree is interrupted", () => {
        const ctx = new TestContext();
        const tree = ctx.createTree(
            scope("outer", scope("s", seq("in", letv("l", "x", 1), read("r", "x", "running")))),
        );
        tree.tick();
        tree.interrupt();
        assert.equal(tree.status, "interrupted");
        assert.deepEqual(ctx.takeLog(), ["read:r=1", "abort:r=1"]);
        assert.equal(tree.blackboard, tree.__rootBlackboard);
    });

    it("keeps the state of Once in the root blackboard", () => {
        const ctx = new TestContext();
        const tree = ctx.createTree(scope("s", n("Once", "once", { children: [probe("a")] })));
        assert.equal(tree.tick(), "success");
        assert.equal(tree.tick(), "failure");
        assert.deepEqual(ctx.takeLog(), ["tick:a"]);
    });

    it("keeps the temp vars in the root blackboard, cleared when interrupted", () => {
        const ctx = new TestContext();
        const tree = ctx.createTree(
            scope("s", n("TempWrite", "t", { args: { status: "running" } })),
        );
        tree.tick();
        const key = Blackboard.makeTempVar(tree.root!.children[0], "k");
        assert.equal(tree.blackboard.get(key), 1);
        tree.interrupt();
        assert.equal(tree.blackboard.get(key), undefined);
    });

    it("is the root blackboard outside the tick", () => {
        const ctx = new TestContext();
        const tree = ctx.createTree(scope("s", seq("in", letv("l", "x", 1), probe("p"))));
        tree.blackboard.set("p", "running");
        tree.tick();
        assert.equal(tree.blackboard, tree.__rootBlackboard);
        assert.equal(tree.blackboard.get("x"), undefined);
    });

    it("prints the variables of the scope in debug mode", () => {
        const ctx = new TestContext();
        const tree = ctx.createTree(scope("s", seq("in", letv("l", "x", 1), probe("p"))));
        tree.blackboard.set("hp", 100);
        tree.debug = true;
        const { info } = captureConsole(() => tree.tick());
        const line = info.find((v) => v.includes("Probe") && v.includes("node:p"))!;
        assert.match(line, /x:1/);
        assert.match(line, /hp:100/);
    });
});

describe("callbacks in a scope", () => {
    it("runs Listen in the captured scope after the scope ends", () => {
        const ctx = new TestContext();
        const tree = ctx.createTree(
            scope(
                "s",
                seq(
                    "in",
                    letv("l", "y", 1),
                    n("Listen", "listen", {
                        args: { event: "hit" },
                        output: ["", "a"],
                        children: [seq("cb", read("ra", "a"), read("ry", "y"), letv("m", "z", 3))],
                    }),
                ),
            ),
        );
        tree.blackboard.set("y", 100);
        assert.equal(tree.tick(), "success");
        ctx.dispatch("hit", undefined, 5);
        assert.deepEqual(ctx.takeLog(), ["read:ra=5", "read:ry=1"]);
        assert.equal(tree.blackboard.get("a"), undefined);
        assert.equal(tree.blackboard.get("y"), 100);
        assert.equal(tree.blackboard.get("z"), undefined);
    });

    it("runs Delay in the captured scope after the scope ends", () => {
        const ctx = new TestContext();
        const tree = ctx.createTree(
            scope(
                "s",
                seq(
                    "in",
                    letv("l", "y", 2),
                    n("Delay", "delay", { args: { delay: 1 }, children: [read("r", "y")] }),
                ),
            ),
        );
        assert.equal(tree.tick(), "success");
        ctx.update(1);
        assert.deepEqual(ctx.takeLog(), ["read:r=2"]);
        assert.equal(tree.blackboard.get("y"), undefined);
    });

    it("reads the current outer value in the callback", () => {
        const ctx = new TestContext();
        const tree = ctx.createTree(
            scope(
                "s",
                n("Listen", "listen", { args: { event: "hit" }, children: [read("r", "hp")] }),
            ),
        );
        tree.tick();
        tree.blackboard.set("hp", 7);
        ctx.dispatch("hit");
        assert.deepEqual(ctx.takeLog(), ["read:r=7"]);
    });

    it("shares the captured scope between the callbacks", () => {
        const ctx = new TestContext();
        const tree = ctx.createTree(
            scope(
                "s",
                n("Once", "once", {
                    children: [
                        n("Listen", "listen", {
                            args: { event: "hit" },
                            children: [seq("cb", read("r", "n"), write("w", "n", 1))],
                        }),
                    ],
                }),
            ),
        );
        tree.tick();
        ctx.dispatch("hit");
        ctx.dispatch("hit");
        // the writes stay in the captured scope, visible to the next callback
        assert.deepEqual(ctx.takeLog(), ["read:r=undefined", "read:r=1"]);
        assert.equal(tree.blackboard.get("n"), undefined);
    });
});

describe("SKIP", () => {
    it("leaves the output variable untouched", () => {
        assert.equal(typeof SKIP, "symbol");
        const ctx = new TestContext();
        const tree = ctx.createTree(scope("s", probe("p"), ["x", "y"]));
        tree.blackboard.set("x", 1);
        tree.tick();
        assert.equal(tree.blackboard.get("x"), 1);
        assert.equal(tree.blackboard.hasOwn("y"), false);
    });
});

describe("tree.bindCallback", () => {
    const bindListen = (id: string, opts: { key: string; write?: string; children?: NodeSpec[] }) =>
        n("BindListen", id, {
            args: { event: "hit", key: opts.key, write: opts.write },
            children: opts.children,
        });

    it("runs the callback in the scope where it is bound", () => {
        const ctx = new TestContext();
        const tree = ctx.createTree(
            scope("s", seq("in", letv("l", "y", 1), bindListen("b", { key: "y", write: "z" }))),
        );
        tree.blackboard.set("y", 100);
        tree.tick();
        ctx.dispatch("hit");
        assert.deepEqual(ctx.takeLog(), ["cb:b=1"]);
        assert.equal(tree.blackboard.get("y"), 100);
        assert.equal(tree.blackboard.get("z"), undefined);
    });

    it("runs in the root blackboard when bound outside a scope", () => {
        const ctx = new TestContext();
        const tree = ctx.createTree(bindListen("b", { key: "y", write: "z" }));
        tree.blackboard.set("y", 100);
        tree.tick();
        ctx.dispatch("hit");
        assert.deepEqual(ctx.takeLog(), ["cb:b=100"]);
        assert.equal(tree.blackboard.get("z"), 1);
    });

    it("ticks the children in the bound scope", () => {
        const ctx = new TestContext();
        const tree = ctx.createTree(
            scope("s", seq("in", letv("l", "y", 1), bindListen("b", { key: "y", write: "z", children: [read("r", "z")] }))),
        );
        tree.tick();
        ctx.dispatch("hit");
        assert.deepEqual(ctx.takeLog(), ["cb:b=1", "read:r=1"]);
    });

    it("restores the scope after the callback", () => {
        const ctx = new TestContext();
        const tree = ctx.createTree(scope("s", seq("in", letv("l", "y", 1), bindListen("b", { key: "y" }))));
        tree.tick();
        ctx.dispatch("hit");
        assert.equal(tree.blackboard, tree.__rootBlackboard);
    });

    it("restores the scope when the callback throws", () => {
        const ctx = new TestContext();
        const tree = ctx.createTree(scope("s", probe("p")));
        let bound: () => void = () => {};
        const inner = tree.blackboard.fork();
        tree.__withScope(inner, () => {
            bound = tree.bindCallback(() => {
                throw new Error("boom");
            });
        });
        assert.throws(() => bound(), /boom/);
        assert.equal(tree.blackboard, tree.__rootBlackboard);
    });

    it("passes the arguments and returns the result", () => {
        const ctx = new TestContext();
        const tree = ctx.createTree(probe("p"));
        const inner = tree.blackboard.fork();
        inner.set("base", 10);
        const add = tree.__withScope(inner, () =>
            tree.bindCallback((a: number, b: number) => a + b + tree.blackboard.get<number>("base")!),
        );
        assert.equal(add(1, 2), 13);
    });

    it("rejects an async callback at compile time", () => {
        const ctx = new TestContext();
        const tree = ctx.createTree(probe("p"));
        // @ts-expect-error an async callback loses the scope after await
        tree.bindCallback(async () => 1);
        // @ts-expect-error a callback which may return a promise
        tree.bindCallback((x: boolean) => (x ? 1 : Promise.resolve(1)));
        // a callback which only throws, or returns nothing, is fine
        tree.bindCallback(() => {
            throw new Error("boom");
        });
        tree.bindCallback(() => {});
    });

    it("throws when the callback returns a promise, and restores the scope", async () => {
        const ctx = new TestContext();
        const tree = ctx.createTree(probe("p"));
        const inner = tree.blackboard.fork();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const fn: any = async () => {};
        const bound = tree.__withScope(inner, () => tree.bindCallback(fn as () => void));
        assert.throws(() => bound(), /must be synchronous/);
        assert.equal(tree.blackboard, tree.__rootBlackboard);
        const thenable = { then: () => {} };
        const bound2 = tree.bindCallback(() => thenable as unknown as void);
        assert.throws(() => bound2(), /must be synchronous/);
    });

    it("binds the synchronous callback of an async task", async () => {
        const ctx = new TestContext();
        const tree = ctx.createTree(probe("p"));
        tree.blackboard.set("x", 9);
        const inner = tree.blackboard.fork();
        inner.set("x", 1);
        const done = tree.__withScope(inner, () =>
            tree.bindCallback((v: number) => `${v}:${tree.blackboard.get("x")}`),
        );
        assert.equal(await Promise.resolve(5).then(done), "5:1");
    });

    it("skips the callback once the tree is cleared", () => {
        const ctx = new TestContext();
        const tree = ctx.createTree(probe("p"));
        let calls = 0;
        const bound = tree.bindCallback(() => ++calls);
        assert.equal(bound(), 1);
        tree.clear();
        assert.equal(bound(), undefined);
        assert.equal(calls, 1);
        // bound after the clear, runs
        const after = tree.bindCallback(() => ++calls);
        assert.equal(after(), 2);
    });

    it("runs the CLEANED and INTERRUPTED listeners during the clear", () => {
        const ctx = new TestContext();
        const tree = ctx.createTree(
            n("Parallel", "root", {
                children: [
                    n("Listen", "l1", { args: { event: TreeEvent.CLEANED }, children: [probe("cleaned")] }),
                    n("Listen", "l2", {
                        args: { event: TreeEvent.INTERRUPTED },
                        children: [probe("interrupted")],
                    }),
                    probe("run", { args: { status: "running" } }),
                ],
            }),
        );
        tree.tick();
        ctx.takeLog();
        tree.clear();
        assert.deepEqual(ctx.takeLog(), ["tick:cleaned", "tick:interrupted", "abort:run"]);
    });

    it("runs a callback dispatched during a tick in the bound scope", () => {
        const ctx = new TestContext();
        const tree = ctx.createTree(
            seq(
                "main",
                bindListen("b", { key: "y", write: "z" }),
                scope("s", seq("in", letv("l", "y", 1), n("Emit", "e", { args: { event: "hit" } }))),
                read("r", "z"),
            ),
        );
        tree.blackboard.set("y", 100);
        tree.tick();
        // bound in the root blackboard, the emitter's scope doesn't leak into the callback
        assert.deepEqual(ctx.takeLog(), ["cb:b=100", "read:r=1"]);
    });
});

describe("scope when interrupted", () => {
    // a condition tree with a running node left behind when the condition is interrupted
    const condTree = (stop: NodeSpec) =>
        probe("p", {
            conditions: [
                cond(
                    seq(
                        "c",
                        letv("l", "x", 1),
                        n("Parallel", "par", {
                            children: [read("r", "x", "running"), stop, write("w", "x", 2)],
                        }),
                    ),
                ),
            ],
        });

    it("aborts the condition tree in its scope when interrupted", () => {
        const ctx = new TestContext();
        const tree = ctx.createTree(condTree(n("Interrupt", "i")));
        tree.blackboard.set("x", 9);
        tree.tick();
        assert.equal(tree.status, "interrupted");
        assert.deepEqual(ctx.takeLog(), ["read:r=1", "abort:r=1"]);
        assert.equal(tree.blackboard.get("x"), 9);
    });

    it("aborts the condition tree in its scope when a node throws", () => {
        const ctx = new TestContext();
        const tree = ctx.createTree(condTree(n("Throw", "t")));
        tree.blackboard.set("x", 9);
        captureConsole(() => tree.tick());
        assert.equal(tree.status, "exception");
        assert.deepEqual(ctx.takeLog(), ["read:r=1", "abort:r=1"]);
    });

    it("aborts the condition tree in its scope when interrupted in a callback", () => {
        const ctx = new TestContext();
        const tree = ctx.createTree(
            n("Parallel", "main", {
                children: [
                    n("Listen", "listen", { args: { event: "hit" }, children: [condTree(n("Interrupt", "i"))] }),
                    probe("run", { args: { status: "running" } }),
                ],
            }),
        );
        tree.blackboard.set("x", 9);
        tree.tick();
        ctx.dispatch("hit");
        assert.equal(tree.status, "interrupted");
        assert.deepEqual(ctx.takeLog(), ["tick:run", "read:r=1", "abort:r=1", "abort:run"]);
    });

    it("aborts the whole tree from the root blackboard when a callback interrupts it", () => {
        const ctx = new TestContext();
        const tree = ctx.createTree(
            seq(
                "main",
                scope(
                    "s",
                    seq(
                        "in",
                        letv("l", "x", 1),
                        n("Listen", "listen", { args: { event: "hit" }, children: [n("Interrupt", "i")] }),
                    ),
                ),
                read("r", "x", "running"),
            ),
        );
        tree.blackboard.set("x", 9);
        tree.tick();
        ctx.dispatch("hit");
        assert.equal(tree.status, "interrupted");
        assert.deepEqual(ctx.takeLog(), ["read:r=9", "abort:r=9"]);
        assert.equal(tree.blackboard, tree.__rootBlackboard);
    });

    it("aborts from the root blackboard when a bound callback interrupts directly", () => {
        const ctx = new TestContext();
        const tree = ctx.createTree(read("r", "x", "running"));
        tree.blackboard.set("x", 9);
        tree.tick();
        const inner = tree.blackboard.fork();
        inner.set("x", 1);
        const bound = tree.__withScope(inner, () =>
            tree.bindCallback(() => {
                tree.interrupt();
                return tree.blackboard;
            }),
        );
        // the bound scope is kept for the rest of the callback
        assert.equal(bound(), inner);
        assert.deepEqual(ctx.takeLog(), ["read:r=9", "abort:r=9"]);
        assert.equal(tree.blackboard, tree.__rootBlackboard);
    });

    it("can't be ticked in a bound callback", () => {
        const ctx = new TestContext();
        const tree = ctx.createTree(read("r", "x"));
        const inner = tree.blackboard.fork();
        const bound = tree.__withScope(inner, () =>
            tree.bindCallback(() => {
                assert.equal(tree.executing, true);
                assert.throws(() => tree.tick(), /is executing \(a callback or an abort\)/);
                return tree.blackboard;
            }),
        );
        assert.equal(bound(), inner);
        assert.deepEqual(ctx.takeLog(), []);
        assert.equal(tree.executing, false);
        assert.equal(tree.blackboard, tree.__rootBlackboard);
    });
});

describe("Delay cacheVars in a scope", () => {
    it("keeps reading the outer variable after restoring an inherited one", () => {
        const ctx = new TestContext();
        const tree = ctx.createTree(
            scope(
                "s",
                seq(
                    "in",
                    n("Delay", "delay", { args: { delay: 1, cacheVars: ["x"] }, children: [read("d", "x")] }),
                    n("Listen", "listen", { args: { event: "hit" }, children: [read("l", "x")] }),
                ),
            ),
        );
        tree.blackboard.set("x", 1);
        tree.tick();
        tree.blackboard.set("x", 2);
        ctx.update(1);
        tree.blackboard.set("x", 3);
        ctx.dispatch("hit");
        assert.deepEqual(ctx.takeLog(), ["read:d=1", "read:l=3"]);
    });

    it("restores the variable of the scope", () => {
        const ctx = new TestContext();
        const tree = ctx.createTree(
            scope(
                "s",
                seq(
                    "in",
                    letv("l", "x", 1),
                    n("Delay", "delay", { args: { delay: 1, cacheVars: ["x"] }, children: [read("d", "x")] }),
                    n("Listen", "listen", {
                        args: { event: "hit" },
                        children: [seq("cb", write("w", "x", 2), n("Listen", "l2", { args: { event: "hit2" }, children: [read("r", "x")] }))],
                    }),
                ),
            ),
        );
        tree.tick();
        ctx.dispatch("hit");
        ctx.update(1);
        tree.blackboard.set("x", 3);
        ctx.dispatch("hit2");
        // the scope's own x (2) is restored, it still shadows the outer x
        assert.deepEqual(ctx.takeLog(), ["read:d=1", "read:r=2"]);
    });
});
