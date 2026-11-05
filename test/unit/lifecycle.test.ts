import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Tree, TreeEvent } from "../../src/behavior3";
import { captureConsole, n, probe, TestContext } from "./helpers";

/**
 * The rules table of docs/design.md (2.6): `tick`, `interrupt` and `clear` called while the tree
 * is doing something. The tree is a Parallel of two running nodes A and B, with nodes calling the
 * operation from the place of each row.
 */

type Op = "tick" | "interrupt" | "clear";

/** Where the operation is called. */
const places = {
    idle: "idle, running",
    tick: "a node in the tick",
    callback: "a callback outside the tick",
    callbackInTick: "a callback in the tick",
    bound: "a bindCallback callback",
    abortExternal: "onAbort of an interrupt outside the tick",
    abortTickEnd: "onAbort of an interrupt at the end of the tick",
    abortInClear: "onAbort of a clear",
    cleaned: "a CLEANED listener",
    onClear: "onClear",
} as const;
type Place = keyof typeof places;

type Expected = {
    /** The return of the operation, or the error it throws. */
    result: string | RegExp;
    /** INTERRUPTED and CLEANED dispatched. */
    interrupted: number;
    cleaned: number;
    /** A and B aborted, cleared (`onAbort`, `onClear` called once each). */
    aborted: boolean;
    cleared: boolean;
    status: string;
    /** The error is logged (caught by a node, a listener or the abort), not thrown to the caller. */
    logged: boolean;
};

const ALREADY_TICKING = /already ticking/;
const EXECUTING = /is executing \(a callback, an abort or a clear\)/;

const tickRules: Record<Place, Expected> = {
    idle: { result: "running", interrupted: 0, cleaned: 0, aborted: false, cleared: false, status: "running", logged: false },
    tick: { result: ALREADY_TICKING, interrupted: 1, cleaned: 0, aborted: true, cleared: false, status: "exception", logged: true },
    callback: { result: EXECUTING, interrupted: 0, cleaned: 0, aborted: false, cleared: false, status: "running", logged: true },
    callbackInTick: { result: ALREADY_TICKING, interrupted: 0, cleaned: 0, aborted: false, cleared: false, status: "running", logged: true },
    bound: { result: EXECUTING, interrupted: 0, cleaned: 0, aborted: false, cleared: false, status: "running", logged: false },
    abortExternal: { result: EXECUTING, interrupted: 1, cleaned: 0, aborted: true, cleared: false, status: "interrupted", logged: true },
    abortTickEnd: { result: ALREADY_TICKING, interrupted: 1, cleaned: 0, aborted: true, cleared: false, status: "interrupted", logged: true },
    abortInClear: { result: EXECUTING, interrupted: 1, cleaned: 1, aborted: true, cleared: true, status: "success", logged: true },
    cleaned: { result: EXECUTING, interrupted: 1, cleaned: 1, aborted: true, cleared: true, status: "success", logged: true },
    onClear: { result: EXECUTING, interrupted: 1, cleaned: 1, aborted: true, cleared: true, status: "success", logged: true },
};

const interrupted = { result: "undefined", interrupted: 1, cleaned: 0, aborted: true, cleared: false, status: "interrupted", logged: false };
const cleared = { result: "undefined", interrupted: 1, cleaned: 1, aborted: true, cleared: true, status: "success", logged: false };

const interruptRules: Record<Place, Expected> = {
    idle: interrupted,
    tick: interrupted,
    callback: interrupted,
    callbackInTick: interrupted,
    bound: interrupted,
    abortExternal: interrupted,
    abortTickEnd: interrupted,
    abortInClear: cleared,
    cleaned: cleared,
    onClear: cleared,
};

const clearRules = Object.fromEntries(Object.keys(places).map((k) => [k, cleared])) as Record<Place, Expected>;

const rules: Record<Op, Record<Place, Expected>> = { tick: tickRules, interrupt: interruptRules, clear: clearRules };

/** Runs `op` from `place` once, returns what happened. */
const run = (place: Place, op: Op) => {
    const ctx = new TestContext();
    const tree = ctx.createTree(
        n("Parallel", "par", {
            children: [
                n("ClearSpy", "A", { args: { status: "running" } }),
                n("ClearSpy", "B", { args: { status: "running" } }),
                probe("hook", { args: { status: "running" } }),
                n("BindListen", "listen", { args: { event: "e", key: "k" }, children: [probe("cb")] }),
            ],
        }),
    );
    const [a, , hook, listen] = tree.root!.children;
    const cb = listen.children[0];

    let armed: Place | undefined;
    let result: unknown = "not called";
    const call = (t: Tree<TestContext, unknown>, at: Place) => {
        if (armed !== at) {
            return;
        }
        armed = undefined;
        try {
            result = String(op === "tick" ? t.tick() : op === "interrupt" ? t.interrupt() : t.clear());
        } catch (e) {
            result = e;
            throw e;
        }
    };

    let bound: (() => unknown) | undefined;
    const { onAbort, onClear } = a;
    a.onAbort = (t) => {
        onAbort.call(a, t);
        call(t as Tree<TestContext, unknown>, "abortExternal");
        call(t as Tree<TestContext, unknown>, "abortTickEnd");
        call(t as Tree<TestContext, unknown>, "abortInClear");
    };
    a.onClear = (t) => {
        onClear.call(a, t);
        call(t as Tree<TestContext, unknown>, "onClear");
    };
    const hookTick = hook.onTick;
    hook.onTick = (t) => {
        call(t as Tree<TestContext, unknown>, "tick");
        if (armed === "callbackInTick") {
            t.context.dispatch("e");
        } else if (armed === "abortTickEnd") {
            t.interrupt();
        }
        bound ??= t.bindCallback(() => call(t as Tree<TestContext, unknown>, "bound"));
        return hookTick.call(hook, t);
    };
    const cbTick = cb.onTick;
    cb.onTick = (t) => {
        call(t as Tree<TestContext, unknown>, "callback");
        call(t as Tree<TestContext, unknown>, "callbackInTick");
        return cbTick.call(cb, t);
    };

    const events = { interrupted: 0, cleaned: 0 };
    ctx.on(TreeEvent.INTERRUPTED, tree, () => events.interrupted++, "test");
    ctx.on(TreeEvent.CLEANED, tree, () => {
        events.cleaned++;
        call(tree, "cleaned");
    }, "test");

    assert.equal(tree.tick(), "running");
    ctx.takeLog();
    armed = place;
    let thrown: unknown;
    const { error } = captureConsole(() => {
        try {
            if (place === "idle") {
                call(tree, "idle");
            } else if (place === "tick" || place === "callbackInTick" || place === "abortTickEnd") {
                tree.tick();
            } else if (place === "callback") {
                ctx.dispatch("e");
            } else if (place === "bound") {
                bound!();
            } else if (place === "abortExternal") {
                tree.interrupt();
            } else {
                tree.clear();
            }
        } catch (e) {
            thrown = e;
        }
    });
    assert.equal(armed, undefined, "the operation is called");
    return { ctx, tree, result, thrown, error, events, log: ctx.takeLog() };
};

describe("lifecycle rules", () => {
    for (const op of ["tick", "interrupt", "clear"] as Op[]) {
        for (const place of Object.keys(places) as Place[]) {
            const expected = rules[op][place];
            it(`${op} in ${places[place]}`, () => {
                const { tree, result, thrown, error, events, log } = run(place, op);
                if (expected.result instanceof RegExp) {
                    assert.ok(result instanceof Error);
                    assert.match(result.message, expected.result);
                    if (expected.logged) {
                        assert.equal(thrown, undefined);
                        assert.equal(error.length, 1);
                        assert.match(error[0], expected.result);
                    } else {
                        assert.equal(thrown, result);
                        assert.equal(error.length, 0);
                    }
                } else {
                    assert.equal(result, expected.result);
                    assert.equal(thrown, undefined);
                    assert.deepEqual(error, []);
                }
                assert.deepEqual(events, { interrupted: expected.interrupted, cleaned: expected.cleaned });
                const count = (entry: string) => log.filter((v) => v === entry).length;
                for (const id of ["A", "B"]) {
                    assert.equal(count(`abort:${id}`), expected.aborted ? 1 : 0, `abort:${id}`);
                    assert.equal(count(`clear:${id}`), expected.cleared ? 1 : 0, `clear:${id}`);
                }
                assert.equal(tree.isRunning(tree.root!), expected.status === "running");
                assert.equal(tree.status, expected.status);
                assert.equal(tree.executing, false);
                assert.equal(tree.ticking, false);
                assert.equal(tree.blackboard, tree.__rootBlackboard);
            });
        }
    }
});

describe("lifecycle invariants", () => {
    for (const where of ["idle", "in the tick"]) {
        it(`dispatches INTERRUPTED once when its listener interrupts again (${where})`, () => {
            const ctx = new TestContext();
            const tree = ctx.createTree(probe("a", { args: { status: "running" } }));
            assert.equal(tree.tick(), "running");
            let calls = 0;
            ctx.on(TreeEvent.INTERRUPTED, tree, () => {
                calls++;
                tree.interrupt();
            }, "test");
            ctx.takeLog();
            if (where === "idle") {
                tree.interrupt();
            } else {
                tree.root!.onTick = (t) => (t.interrupt(), "running");
                assert.equal(tree.tick(), "interrupted");
            }
            assert.equal(calls, 1);
            assert.deepEqual(ctx.takeLog().filter((v) => v.startsWith("abort")), ["abort:a"]);
            assert.equal(tree.status, "interrupted");
        });
    }

    it("dispatches INTERRUPTED once when interrupted then cleared in a tick", () => {
        const ctx = new TestContext();
        const tree = ctx.createTree(
            n("Parallel", "par", {
                children: [probe("a", { args: { status: "running" } }), probe("b", { args: { status: "running" } })],
            }),
        );
        assert.equal(tree.tick(), "running");
        const events: string[] = [];
        ctx.on(TreeEvent.INTERRUPTED, tree, () => events.push("interrupted"), "test");
        ctx.on(TreeEvent.CLEANED, tree, () => events.push("cleaned"), "test");
        tree.root!.children[1].onTick = (t) => {
            t.interrupt();
            t.clear();
            return "running";
        };
        ctx.takeLog();
        assert.equal(tree.tick(), "interrupted");
        // interrupted first, the abort is left to the clear
        assert.deepEqual(events, ["interrupted", "cleaned"]);
        assert.deepEqual(ctx.takeLog().filter((v) => v.startsWith("abort")), ["abort:a", "abort:b"]);
        assert.equal(tree.status, "success");
    });

    it("dispatches INTERRUPTED once when interrupted then cleared in a callback", () => {
        const ctx = new TestContext();
        const tree = ctx.createTree(
            n("Parallel", "par", {
                children: [
                    probe("a", { args: { status: "running" } }),
                    n("BindListen", "listen", { args: { event: "e", key: "k" }, children: [probe("cb")] }),
                ],
            }),
        );
        assert.equal(tree.tick(), "running");
        tree.root!.children[1].children[0].onTick = (t) => {
            t.interrupt();
            t.clear();
            return "success";
        };
        const events: string[] = [];
        ctx.on(TreeEvent.INTERRUPTED, tree, () => events.push("interrupted"), "test");
        ctx.on(TreeEvent.CLEANED, tree, () => events.push("cleaned"), "test");
        ctx.takeLog();
        ctx.dispatch("e");
        assert.deepEqual(events, ["interrupted", "cleaned"]);
        assert.deepEqual(ctx.takeLog().filter((v) => v.startsWith("abort")), ["abort:a"]);
        assert.equal(tree.status, "success");
        assert.equal(tree.executing, false);
    });

    it("interrupts again after an interruption is done", () => {
        const ctx = new TestContext();
        const tree = ctx.createTree(probe("a", { args: { status: "running" } }));
        let calls = 0;
        ctx.on(TreeEvent.INTERRUPTED, tree, () => calls++, "test");
        for (let i = 1; i <= 2; i++) {
            assert.equal(tree.tick(), "running");
            tree.interrupt();
            assert.equal(calls, i);
            assert.equal(tree.status, "interrupted");
        }
    });

    it("is executing while clearing", () => {
        const ctx = new TestContext();
        const tree = ctx.createTree(probe("a"));
        const seen: boolean[] = [];
        ctx.on(TreeEvent.CLEANED, tree, () => seen.push(tree.executing), "test");
        tree.root!.onClear = (t) => seen.push(t.executing);
        tree.clear();
        assert.deepEqual(seen, [true, true]);
        assert.equal(tree.executing, false);
    });
});

