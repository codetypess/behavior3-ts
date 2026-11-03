import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Blackboard, SKIP } from "../../src/behavior3";
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
