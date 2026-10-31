import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Node, NodeDef, Status } from "../../src/behavior3";
import { captureConsole, n, NodeSpec, probe, TestContext } from "./helpers";

/**
 * Ticks a single node once with the given blackboard values.
 * The status is `error` when the node throws.
 */
const run = (spec: NodeSpec, values: Record<string, unknown> = {}) => {
    const ctx = new TestContext();
    const tree = ctx.createTree(spec);
    for (const k in values) tree.blackboard.set(k, values[k]);
    const { result, error, warn } = captureConsole(() => tree.tick());
    return { status: result, bb: tree.blackboard, error, warn, ctx, tree };
};

describe("node creation", () => {
    it("throws on unregistered nodes", () => {
        const ctx = new TestContext();
        assert.throws(() => ctx.createTree(n("NoSuchNode", "x")), /is not registered/);
    });

    it("throws when overriding tick", () => {
        class BadTick extends Node {
            override tick(): Status {
                return "success";
            }
            override onTick(): Status {
                return "success";
            }
            static override get descriptor(): NodeDef {
                return { name: "BadTick", type: "Action", desc: "" };
            }
        }
        const ctx = new TestContext();
        ctx.registerNode(BadTick);
        assert.throws(() => ctx.createTree(n("BadTick", "x")), /don't override 'tick'/);
    });

    it("checks the number of children", () => {
        const ctx = new TestContext();
        assert.throws(() => ctx.createTree(n("IfElse", "if", { children: [probe("a")] })), /at least 3 children/);
        const { warn } = captureConsole(() =>
            ctx.createTree(n("Invert", "inv", { children: [probe("a"), probe("b")] })),
        );
        assert.match(warn[0], /exactly 1 children/);
        const { warn: warn2 } = captureConsole(() => ctx.createTree(n("Wait", "w", { children: [probe("a")] })));
        assert.match(warn2[0], /no children is required/);
    });

    it("skips disabled children", () => {
        const { status, ctx } = run(n("Sequence", "seq", { children: [probe("a", { disabled: true }), probe("b")] }));
        assert.equal(status, "success");
        assert.deepEqual(ctx.takeLog(), ["tick:b"]);
    });

    it("assigns unique indexes including condition trees", () => {
        const ctx = new TestContext();
        const tree = ctx.createTree(
            n("Sequence", "seq", {
                children: [probe("a", { conditions: [{ root: n("Invert", "inv", { children: [probe("c")] }) }] }), probe("b")],
            }),
        );
        const indexes: number[] = [];
        const visit = (node: Node) => {
            indexes.push(node.index);
            node.conditions.forEach((c) => visit(c.root));
            node.children.forEach(visit);
        };
        visit(tree.root!);
        assert.deepEqual(indexes, [0, 1, 2, 3, 4]);
    });
});

describe("conditions nodes", () => {
    it("Check evaluates the expression", () => {
        assert.equal(run(n("Check", "c", { args: { value: "hp > 50" } }), { hp: 60 }).status, "success");
        assert.equal(run(n("Check", "c", { args: { value: "hp > 50" } }), { hp: 40 }).status, "failure");
    });

    it("Check throws on invalid expressions", () => {
        const ctx = new TestContext();
        assert.throws(() => ctx.createTree(n("Check", "c", { args: { value: "" } })), /not a expr string/);
        assert.throws(() => ctx.createTree(n("Check", "c", { args: { value: "a +" } })), /invalid expression/);
    });

    it("IsNull and NotNull", () => {
        const isNull = n("IsNull", "x", { input: ["v"] });
        const notNull = n("NotNull", "x", { input: ["v"] });
        assert.equal(run(isNull).status, "success");
        assert.equal(run(isNull, { v: 0 }).status, "failure");
        assert.equal(run(notNull).status, "failure");
        assert.equal(run(notNull, { v: 0 }).status, "success");
    });

    it("Includes", () => {
        const spec = n("Includes", "x", { input: ["arr", "e"] });
        assert.equal(run(spec, { arr: [1, 2], e: 2 }).status, "success");
        assert.equal(run(spec, { arr: [1, 2], e: 3 }).status, "failure");
        assert.equal(run(spec, { arr: [1, 2] }).status, "failure");
        assert.equal(run(spec, { arr: 1, e: 1 }).status, "error");
    });
});

describe("action nodes", () => {
    it("JustSuccess and JustFailure", () => {
        assert.equal(run(n("JustSuccess", "x")).status, "success");
        assert.equal(run(n("JustFailure", "x")).status, "failure");
    });

    it("Let outputs the arg or the input", () => {
        assert.equal(run(n("Let", "x", { args: { value: 1 }, output: ["v"] })).bb.get("v"), 1);
        assert.equal(run(n("Let", "x", { input: ["src"], output: ["v"] }), { src: "s" }).bb.get("v"), "s");
        // null clears the output
        assert.equal(run(n("Let", "x", { output: ["v"] }), { v: 1 }).bb.get("v"), undefined);
    });

    it("Calculate outputs the value of the expression", () => {
        const { status, bb } = run(n("Calculate", "x", { args: { value: "a * 2 + b" }, output: ["v"] }), { a: 3, b: 1 });
        assert.equal(status, "success");
        assert.equal(bb.get("v"), 7);
    });

    it("Concat concatenates two arrays", () => {
        const spec = n("Concat", "x", { input: ["a", "b"], output: ["v"] });
        assert.deepEqual(run(spec, { a: [1], b: [2, 3] }).bb.get("v"), [1, 2, 3]);
        assert.equal(run(spec, { a: [1], b: 2 }).status, "error");
    });

    it("GetField reads a field by arg or input", () => {
        const byArg = n("GetField", "x", { args: { field: "hp" }, input: ["obj"], output: ["v"] });
        assert.equal(run(byArg, { obj: { hp: 3 } }).bb.get("v"), 3);
        assert.equal(run(byArg, { obj: {} }).status, "failure");
        assert.equal(run(byArg, { obj: 1 }).status, "error");
        const byInput = n("GetField", "x", { input: ["obj", "key"], output: ["v"] });
        assert.equal(run(byInput, { obj: { hp: 3 }, key: "hp" }).bb.get("v"), 3);
        assert.equal(run(byInput, { obj: [1, 2], key: 1 }).bb.get("v"), 2);
        const bad = run(byInput, { obj: {}, key: true });
        assert.equal(bad.status, "error");
        assert.match(bad.error[0], /invalid field: true/);
    });

    it("SetField sets or deletes a field", () => {
        const obj: Record<string, unknown> = { a: 1 };
        run(n("SetField", "x", { args: { field: "b", value: { c: 1 } }, input: ["obj"] }), { obj });
        assert.deepEqual(obj.b, { c: 1 });
        run(n("SetField", "x", { args: { field: "a" }, input: ["obj"] }), { obj });
        assert.equal("a" in obj, false);
        run(n("SetField", "x", { input: ["obj", "f", "v"] }), { obj, f: "d", v: 4 });
        assert.equal(obj.d, 4);
        assert.equal(run(n("SetField", "x", { args: { field: "a" }, input: ["obj"] }), { obj: 1 }).status, "error");
        const bad = run(n("SetField", "x", { input: ["obj", "f"] }), { obj, f: true });
        assert.equal(bad.status, "error");
        assert.match(bad.error[0], /invalid field: true/);
    });

    it("SetField gets a fresh json value every tick", () => {
        const ctx = new TestContext();
        const tree = ctx.createTree(n("SetField", "x", { args: { field: "v", value: { n: 1 } }, input: ["obj"] }));
        const a: Record<string, { n: number }> = {};
        const b: Record<string, { n: number }> = {};
        tree.blackboard.set("obj", a);
        tree.tick();
        tree.blackboard.set("obj", b);
        tree.tick();
        a.v.n = 2;
        assert.equal(b.v.n, 1);
    });

    it("Index reads an element", () => {
        const spec = n("Index", "x", { args: { index: 1 }, input: ["arr"], output: ["v"] });
        assert.equal(run(spec, { arr: [1, 2] }).bb.get("v"), 2);
        assert.equal(run(spec, { arr: [1] }).status, "failure");
        assert.equal(run(spec, { arr: 1 }).status, "error");
        const byInput = n("Index", "x", { input: ["arr", "i"], output: ["v"] });
        assert.equal(run(byInput, { arr: [1, 2], i: 0 }).bb.get("v"), 1);
        assert.equal(run(byInput, { arr: [1, 2], i: -1 }).status, "failure");
        const bad = run(byInput, { arr: [1, 2], i: "a" });
        assert.equal(bad.status, "error");
        assert.match(bad.error[0], /invalid index: a/);
    });

    it("Push pushes an element", () => {
        const arr = [1];
        assert.equal(run(n("Push", "x", { input: ["arr", "e"] }), { arr, e: 2 }).status, "success");
        assert.deepEqual(arr, [1, 2]);
        assert.equal(run(n("Push", "x", { input: ["arr", "e"] }), { arr: 1, e: 2 }).status, "error");
    });

    it("RandomIndex picks an element and its index", () => {
        const spec = n("RandomIndex", "x", { input: ["arr"], output: ["v", "i"] });
        const { bb } = run(spec, { arr: [5, 6, 7] });
        const i = bb.get<number>("i")!;
        assert.equal(bb.get("v"), [5, 6, 7][i]);
        assert.equal(run(spec, { arr: [] }).status, "failure");
        assert.equal(run(spec, { arr: 1 }).status, "error");
    });

    it("Now outputs the context time", () => {
        const ctx = new TestContext();
        const tree = ctx.createTree(n("Now", "x", { output: ["t"] }));
        ctx.update(3);
        tree.tick();
        assert.equal(tree.blackboard.get("t"), 3);
    });

    it("Math computes with args and inputs", () => {
        const math = (op: string, values: Record<string, unknown>, opts: Record<string, unknown> = {}) =>
            run(n("Math", "x", { args: { op, ...opts }, input: Object.keys(values), output: ["v"] }), values);
        const v = (op: string, ...values: number[]) =>
            math(op, Object.fromEntries(values.map((value, i) => [`p${i}`, value]))).bb.get<number>("v");
        assert.equal(v("abs", -2), 2);
        assert.equal(v("ceil", 1.2), 2);
        assert.equal(v("floor", 1.8), 1);
        assert.equal(v("round", 1.5), 2);
        assert.equal(v("sign", -3), -1);
        assert.equal(v("sin", 0), 0);
        assert.equal(v("cos", 0), 1);
        assert.equal(v("tan", 0), 0);
        assert.equal(v("sqrt", 9), 3);
        assert.equal(v("log", Math.E), 1);
        assert.equal(v("pow", 2, 3), 8);
        assert.equal(v("atan2", 1, 1), Math.PI / 4);
        assert.equal(v("min", 3, 1, 2), 1);
        assert.equal(v("max", 1, 5, 3), 5);
        assert.equal(v("sum", 1, 2, 3), 6);
        assert.equal(v("average", 1, 2, 3), 2);
        assert.equal(v("product", 2, 3, 4), 24);
        // value1 and value2 take precedence over the inputs
        assert.equal(math("abs", {}, { value1: -2 }).bb.get("v"), 2);
        assert.equal(math("pow", { a: 2 }, { value2: 3 }).bb.get("v"), 8);
        assert.equal(math("pow", { a: 2, b: 2 }, { value1: 3 }).bb.get("v"), 9);
        const ctx = new TestContext();
        assert.throws(() => ctx.createTree(n("Math", "x", { args: { op: "nope" } })), /unknown op/);
    });

    it("Math random numbers", () => {
        const math = (op: string, opts: Record<string, unknown> = {}) =>
            run(n("Math", "x", { args: { op, ...opts }, output: ["v"] })).bb.get<number>("v")!;
        for (let i = 0; i < 20; i++) {
            const r = math("random");
            assert.ok(r >= 0 && r < 1);
            const int = math("randInt", { value1: 1, value2: 3 });
            assert.ok(Number.isInteger(int) && int >= 1 && int <= 3);
            const float = math("randFloat", { value1: 1, value2: 2 });
            assert.ok(float >= 1 && float < 2);
        }
    });

    it("Math throws on bad parameters", () => {
        const math = (op: string, values: Record<string, unknown>, opts: Record<string, unknown> = {}) =>
            run(n("Math", "x", { args: { op, ...opts }, input: Object.keys(values), output: ["v"] }), values);
        const cases: [string, Record<string, unknown>, Record<string, unknown>, RegExp][] = [
            ["abs", {}, {}, /at least one parameter/],
            ["abs", { a: 1, b: 2 }, {}, /abs operation requires exactly one parameter/],
            ["pow", { a: 1 }, {}, /pow operation requires exactly two parameters/],
            ["randInt", {}, { value1: 3, value2: 1 }, /minimum value cannot be greater/],
            ["randFloat", {}, { value1: 3, value2: 1 }, /minimum value cannot be greater/],
            ["randInt", {}, { value1: 1 }, /requires two parameters/],
            // an input which is not a number
            ["max", { a: 1, b: "abc" }, {}, /result is NaN/],
            ["sqrt", { a: -1 }, {}, /result is NaN/],
        ];
        for (const [op, values, opts, msg] of cases) {
            const { status, error } = math(op, values, opts);
            assert.equal(status, "error", op);
            assert.match(error[0], msg);
        }
    });

    it("Log prints by level", () => {
        const ctx = new TestContext();
        const tree = ctx.createTree(
            n("Sequence", "seq", {
                children: [
                    n("Log", "a", { args: { message: "hello", level: "warn" }, input: ["extra"] }),
                    n("Log", "b", { args: { message: "world", level: "error" } }),
                ],
            }),
        );
        tree.blackboard.set("extra", 1);
        const { result, warn, error } = captureConsole(() => tree.tick());
        assert.equal(result, "success");
        assert.equal(warn[0], "behavior3 -> warn: hello 1");
        assert.match(error[0], /world/);

        const levels = n("Sequence", "seq", {
            children: [
                n("Log", "a", { args: { message: "m1" } }),
                n("Log", "b", { args: { message: "m2", level: "info" } }),
                n("Log", "c", { args: { message: "m3", level: "debug" } }),
            ],
        });
        const { log, info, debug } = captureConsole(() => ctx.createTree(levels).tick());
        assert.equal(log[0], "behavior3 -> log: m1 ");
        assert.equal(info[0], "behavior3 -> info: m2 ");
        assert.equal(debug[0], "behavior3 -> debug: m3 ");
    });

    it("Wait adds a random time", () => {
        const random = Math.random;
        Math.random = () => 1;
        try {
            const ctx = new TestContext();
            const tree = ctx.createTree(n("Wait", "w", { args: { time: 5, random: 2 } }));
            tree.tick();
            assert.equal(tree.getState(tree.root!), 6);
        } finally {
            Math.random = random;
        }
    });

    it("WaitForEvent keeps waiting after a long time", () => {
        const ctx = new TestContext();
        const tree = ctx.createTree(n("WaitForEvent", "w", { args: { event: "go" } }));
        tree.tick();
        ctx.update(6);
        assert.equal(tree.tick(), "running");
        ctx.update(6);
        assert.equal(tree.tick(), "running");
        ctx.dispatch("go");
        assert.equal(tree.tick(), "success");
        assert.equal(ctx.listenerCount("go"), 0);
    });

    it("Wait reads the time from the input", () => {
        const ctx = new TestContext();
        const tree = ctx.createTree(n("Wait", "w", { input: ["t"] }));
        tree.blackboard.set("t", 2);
        tree.tick();
        ctx.update(1);
        assert.equal(tree.tick(), "running");
        ctx.update(1);
        assert.equal(tree.tick(), "success");
    });

    it("missing required input throws", () => {
        const ctx = new TestContext();
        const tree = ctx.createTree(n("Index", "x", { input: ["arr", "i"], output: ["v"] }));
        tree.blackboard.set("arr", [1]);
        const { result, error } = captureConsole(() => tree.tick());
        assert.equal(result, "error");
        assert.match(error[0], /missing input 'i'/);
    });

    it("an input of the wrong type throws", () => {
        const { status, error } = run(n("Concat", "x", { input: ["a", "b"] }), { a: [1], b: 2 });
        assert.equal(status, "error");
        assert.match(error[0], /Concat#x: invalid array: 1 or 2/);
    });
});

describe("output", () => {
    it("writes outputs when the node finishes", () => {
        const ctx = new TestContext();
        const tree = ctx.createTree(
            n("Sequence", "seq", { children: [n("Now", "now", { output: ["t"] }), probe("a")] }),
        );
        ctx.update(1);
        tree.tick();
        assert.equal(tree.blackboard.get("t"), 1);
    });

    it("does not write outputs while running", () => {
        const ctx = new TestContext();
        const tree = ctx.createTree(
            n("Filter", "f", { input: ["arr"], output: ["item", "result"], children: [probe("a")] }),
        );
        tree.blackboard.set("arr", [1]);
        tree.blackboard.set("result", "old");
        tree.blackboard.set("a", "running");
        tree.tick();
        assert.equal(tree.blackboard.get("result"), "old");
    });
});

describe("debug", () => {
    it("prints the status, abort and condition failures", () => {
        const ctx = new TestContext();
        const tree = ctx.createTree(
            n("Selector", "sel", {
                children: [
                    probe("a", { conditions: [{ abort: "lower", root: probe("c") }] }),
                    probe("b", { args: { status: "running" } }),
                ],
            }),
        );
        tree.debug = true;
        tree.blackboard.set("c", "failure");
        const first = captureConsole(() => tree.tick());
        assert.ok(first.info.some((v) => /Probe: .*node:a, status:failure \(conditions\)/.test(v)));
        assert.ok(first.info.some((v) => /node:b, status:running/.test(v)));
        tree.blackboard.set("c", "success");
        const second = captureConsole(() => tree.tick());
        assert.ok(second.info.some((v) => /node:b, status:aborted/.test(v)));
    });
});
