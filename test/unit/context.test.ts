import assert from "node:assert/strict";
import { describe, it } from "node:test";
import v8 from "node:v8";
import vm from "node:vm";
import { Blackboard, getNodeDescriptors, Node, NodeDef, registerNode, Status } from "../../src/behavior3";
import { n, probe, TestContext } from "./helpers";

class GroupOnly extends Node {
    override onTick(): Status {
        return "success";
    }

    static override get descriptor(): NodeDef {
        return { name: "GroupOnly", type: "Action", desc: "only in group G", group: ["G"] };
    }
}
registerNode(GroupOnly);

class GroupContext extends TestContext {
    override get supportGroupTypes() {
        return ["G"];
    }
}

describe("blackboard", () => {
    it("get, set and clear", () => {
        const ctx = new TestContext();
        const tree = ctx.createTree(probe("a"));
        const bb = tree.blackboard;
        bb.set("x", 1);
        bb.set("zero", 0);
        bb.set("no", false);
        assert.equal(bb.get("x"), 1);
        assert.equal(bb.get("zero"), 0);
        assert.equal(bb.get("no"), false);
        // undefined and null delete the key
        bb.set("x", undefined);
        bb.set("zero", null);
        assert.equal("x" in bb.values, false);
        assert.equal("zero" in bb.values, false);
        // an empty key is ignored
        bb.set("", 1);
        assert.equal(bb.get(""), undefined);
        assert.deepEqual(bb.values, { no: false });
        bb.clear();
        assert.deepEqual(bb.values, {});
    });

    it("eval runs an expression with the values", () => {
        const ctx = new TestContext();
        const tree = ctx.createTree(probe("a"));
        tree.blackboard.set("hp", 10);
        assert.equal(tree.blackboard.eval("hp * 2"), 20);
    });

    it("private and temp variable names", () => {
        const ctx = new TestContext();
        const tree = ctx.createTree(probe("a"));
        const node = tree.root!;
        const privateVar = Blackboard.makePrivateVar(node, "k");
        const temp = Blackboard.makeTempVar(node, "k");
        assert.equal(Blackboard.isPrivateVar(privateVar), true);
        assert.equal(Blackboard.isPrivateVar(Blackboard.makePrivateVar("k")), true);
        assert.equal(Blackboard.isTempVar(temp), true);
        assert.equal(Blackboard.isTempVar(privateVar), false);
        assert.equal(Blackboard.isPrivateVar("k"), false);
        assert.notEqual(privateVar, Blackboard.makePrivateVar(node, "other"));
    });
});

describe("context timers", () => {
    it("runs expired timers in order", () => {
        const ctx = new TestContext();
        const log: string[] = [];
        ctx.delay(2, () => log.push("b"), "t");
        ctx.delay(1, () => log.push("a"), "t");
        ctx.delay(3, () => log.push("c"), "t");
        ctx.update(0.5);
        assert.deepEqual(log, []);
        ctx.update(2);
        assert.deepEqual(log, ["a", "b"]);
        assert.equal(ctx.time, 2.5);
        ctx.update(1);
        assert.deepEqual(log, ["a", "b", "c"]);
    });

    it("the same callback is replaced", () => {
        const ctx = new TestContext();
        let count = 0;
        const callback = () => count++;
        ctx.delay(1, callback, "t");
        ctx.delay(3, callback, "t");
        ctx.update(2);
        assert.equal(count, 0);
        ctx.update(1);
        assert.equal(count, 1);
        ctx.update(10);
        assert.equal(count, 1);
    });

    it("offAll removes the timers of the tag", () => {
        const ctx = new TestContext();
        const log: string[] = [];
        ctx.delay(1, () => log.push("a"), "x");
        ctx.delay(1, () => log.push("b"), "y");
        ctx.offAll("x");
        ctx.update(1);
        assert.deepEqual(log, ["b"]);
    });
});

describe("context timer heap", () => {
    it("runs the timers expiring at the same time in the order they are scheduled", () => {
        const ctx = new TestContext();
        const log: string[] = [];
        for (const name of ["a", "b", "c", "d", "e"]) {
            ctx.delay(1, () => log.push(name), "t");
        }
        ctx.delay(0.5, () => log.push("first"), "t");
        ctx.update(1);
        assert.deepEqual(log, ["first", "a", "b", "c", "d", "e"]);
    });

    it("replaces the timer of the same callback, keeping the new order", () => {
        const ctx = new TestContext();
        const log: string[] = [];
        const a = () => log.push("a");
        ctx.delay(1, a, "t");
        ctx.delay(1, () => log.push("b"), "t");
        // scheduled again: now after b
        ctx.delay(1, a, "t");
        ctx.update(1);
        assert.deepEqual(log, ["b", "a"]);
    });

    it("cancels one timer with the returned function", () => {
        const ctx = new TestContext();
        const log: string[] = [];
        const cancelA = ctx.delay(1, () => log.push("a"), "t");
        ctx.delay(1, () => log.push("b"), "t");
        cancelA();
        cancelA();
        ctx.update(1);
        assert.deepEqual(log, ["b"]);
    });

    it("does nothing when cancelled after running or being replaced", () => {
        const ctx = new TestContext();
        let count = 0;
        const callback = () => count++;
        const cancelOld = ctx.delay(1, callback, "t");
        ctx.delay(2, callback, "t");
        cancelOld();
        ctx.update(2);
        assert.equal(count, 1);
        const cancel = ctx.delay(1, callback, "t");
        ctx.update(1);
        cancel();
        assert.equal(count, 2);
    });

    it("runs a timer scheduled by a timer in the next update, even if it has expired", () => {
        const ctx = new TestContext();
        const log: string[] = [];
        ctx.delay(1, () => {
            log.push("a");
            ctx.delay(0, () => log.push("now"), "t");
            ctx.delay(-1, () => log.push("negative"), "t");
            ctx.delay(1, () => log.push("later"), "t");
        }, "t");
        ctx.delay(1, () => log.push("b"), "t");
        ctx.update(1);
        assert.deepEqual(log, ["a", "b"]);
        ctx.update(0);
        assert.deepEqual(log, ["a", "b", "now", "negative"]);
        ctx.update(1);
        assert.deepEqual(log, ["a", "b", "now", "negative", "later"]);
    });

    it("doesn't loop on a timer rescheduling itself with a delay of 0", () => {
        const ctx = new TestContext();
        let count = 0;
        const tick = () => {
            count++;
            ctx.delay(0, tick, "t");
        };
        ctx.delay(0, tick, "t");
        ctx.update(0);
        assert.equal(count, 1);
        ctx.update(0);
        assert.equal(count, 2);
    });

    it("lets a timer reschedule its own callback", () => {
        const ctx = new TestContext();
        let count = 0;
        const tick = () => {
            count++;
            ctx.delay(1, tick, "t");
        };
        ctx.delay(1, tick, "t");
        ctx.update(1);
        ctx.update(1);
        ctx.update(1);
        assert.equal(count, 3);
    });

    it("matches a simple sorted list on random operations", () => {
        // the reference: the timers of the old implementation, a list sorted on insertion
        type Ref = { name: number; callback: () => void; tag: string; expired: number };
        let seed = 42;
        const random = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
        const ctx = new TestContext();
        const ref: Ref[] = [];
        let refTime = 0;
        const fired: number[] = [];
        const refFired: number[] = [];
        const callbacks: (() => void)[] = [];
        const cancels: (() => void)[] = [];
        for (let i = 0; i < 40; i++) {
            const name = i;
            callbacks.push(() => fired.push(name));
        }
        const refUpdate = (dt: number) => {
            refTime += dt;
            while (ref.length > 0 && ref[0].expired <= refTime) {
                refFired.push(ref.shift()!.name);
            }
        };
        for (let step = 0; step < 5000; step++) {
            const op = random();
            const name = Math.floor(random() * callbacks.length);
            const tag = `tag${Math.floor(random() * 5)}`;
            if (op < 0.5) {
                const time = Math.floor(random() * 6) / 2;
                cancels[name] = ctx.delay(time, callbacks[name], tag);
                const old = ref.findIndex((v) => v.name === name);
                if (old >= 0) {
                    ref.splice(old, 1);
                }
                const expired = refTime + time;
                const at = ref.findIndex((v) => v.expired > expired);
                const entry = { name, callback: callbacks[name], tag, expired };
                if (at >= 0) {
                    ref.splice(at, 0, entry);
                } else {
                    ref.push(entry);
                }
            } else if (op < 0.65) {
                cancels[name]?.();
                // the function of a replaced timer does nothing: only the current one
                const at = ref.findIndex((v) => v.name === name);
                if (at >= 0 && cancels[name]) {
                    ref.splice(at, 1);
                }
            } else if (op < 0.7) {
                ctx.offAll(tag);
                for (let i = ref.length - 1; i >= 0; i--) {
                    if (ref[i].tag === tag) {
                        ref.splice(i, 1);
                    }
                }
            } else {
                const dt = Math.floor(random() * 3) / 2;
                ctx.update(dt);
                refUpdate(dt);
            }
        }
        ctx.update(100);
        refUpdate(100);
        assert.ok(fired.length > 1000);
        assert.deepEqual(fired, refFired);
    });
});

describe("context events", () => {
    it("dispatches to the listeners of the target", () => {
        const ctx = new TestContext();
        const target = {};
        const log: unknown[] = [];
        ctx.on("e", (...args: unknown[]) => log.push(["context", ...args]), "x");
        ctx.on("e", target, (...args: unknown[]) => log.push(["target", ...args]), "x");
        ctx.dispatch("e", undefined, 1);
        ctx.dispatch("e", target, 2, 3);
        ctx.dispatch("e", {}, 4);
        ctx.dispatch("other");
        assert.deepEqual(log, [
            ["context", 1],
            ["target", 2, 3],
        ]);
    });

    it("off removes the listeners of the tag", () => {
        const ctx = new TestContext();
        const target = {};
        const log: string[] = [];
        ctx.on("e", target, () => log.push("x"), "x");
        ctx.on("e", target, () => log.push("y"), "y");
        ctx.off("e", "x");
        ctx.dispatch("e", target);
        assert.deepEqual(log, ["y"]);
        ctx.off("e", "y");
        assert.equal(ctx.listenerCount("e"), 0);
    });

    it("offAll removes the listeners of the tag for every event", () => {
        const ctx = new TestContext();
        ctx.on("e1", () => {}, "x");
        ctx.on("e2", {}, () => {}, "x");
        ctx.on("e2", () => {}, "y");
        ctx.offAll("x");
        assert.equal(ctx.listenerCount("e1"), 0);
        assert.equal(ctx.listenerCount("e2"), 1);
    });

    it("calls the listeners registered when the dispatch starts", () => {
        const ctx = new TestContext();
        const log: string[] = [];
        const added = () => log.push("added");
        ctx.on("e", () => {
            log.push("a");
            ctx.on("e", added, "x");
            ctx.off("e", "removed");
        }, "x");
        ctx.on("e", () => log.push("removed"), "removed");
        ctx.on("e", () => log.push("b"), "x");
        ctx.dispatch("e");
        assert.deepEqual(log.splice(0), ["a", "b"]);
        // registered again by "a": replaced, still called once
        ctx.dispatch("e");
        assert.deepEqual(log.splice(0), ["a", "b", "added"]);
    });

    it("calls a listener removed and registered again by a listener once", () => {
        const ctx = new TestContext();
        const log: string[] = [];
        const x = () => log.push("x");
        const cancel = ctx.on("e", x, "x");
        const cancelY = ctx.on("e", () => {
            log.push("y");
            cancel();
            ctx.on("e", x, "x");
            cancelY();
        }, "y");
        // removed then registered again: a new listener, after "y"
        ctx.dispatch("e");
        assert.deepEqual(log.splice(0), ["x", "y"]);
        ctx.dispatch("e");
        assert.deepEqual(log.splice(0), ["x"]);
    });

    it("lets a nested dispatch call the listeners registered before it", () => {
        const ctx = new TestContext();
        const log: string[] = [];
        ctx.on("e", (depth: number) => {
            log.push(`a${depth}`);
            if (depth === 0) {
                ctx.on("e", (d: number) => log.push(`late${d}`), "x");
                ctx.dispatch("e", undefined, 1);
            }
        }, "x");
        ctx.dispatch("e", undefined, 0);
        assert.deepEqual(log, ["a0", "a1", "late1"]);
    });

    it("doesn't loop on a listener registering a new listener of the event", () => {
        const ctx = new TestContext();
        let count = 0;
        const listen = () =>
            ctx.on("e", () => {
                count++;
                listen();
            }, "x");
        listen();
        ctx.dispatch("e");
        assert.equal(count, 1);
        ctx.dispatch("e");
        assert.equal(count, 3);
    });
});

describe("context event cancel", () => {
    it("removes only the listener it is returned for", () => {
        const ctx = new TestContext();
        const target = {};
        const log: string[] = [];
        const cancelA = ctx.on("e", target, () => log.push("a"), "tree");
        ctx.on("e", target, () => log.push("b"), "tree");
        ctx.on("e", () => log.push("c"), "tree");
        cancelA();
        ctx.dispatch("e", target);
        ctx.dispatch("e");
        assert.deepEqual(log, ["b", "c"]);
        assert.equal(ctx.listenerCount("e"), 2);
    });

    it("does nothing when called again", () => {
        const ctx = new TestContext();
        const cancel = ctx.on("e", () => {}, "x");
        cancel();
        cancel();
        assert.equal(ctx.listenerCount("e"), 0);
    });

    it("does nothing after off or offAll", () => {
        const ctx = new TestContext();
        const cancel = ctx.on("e", () => {}, "x");
        ctx.offAll("x");
        const log: string[] = [];
        ctx.on("e", () => log.push("new"), "x");
        cancel();
        ctx.dispatch("e");
        assert.deepEqual(log, ["new"]);
    });

    it("lets the other listeners run when cancelled during the dispatch", () => {
        const ctx = new TestContext();
        const log: string[] = [];
        let cancelB = () => {};
        ctx.on("e", () => {
            log.push("a");
            cancelB();
        }, "x");
        cancelB = ctx.on("e", () => log.push("b"), "x");
        const cancelC = ctx.on("e", () => {
            log.push("c");
            cancelC();
        }, "x");
        ctx.dispatch("e");
        ctx.dispatch("e");
        // b is removed by a before its turn, c removes itself
        assert.deepEqual(log, ["a", "c", "a"]);
    });
});

describe("context releases finished subscriptions", () => {
    v8.setFlagsFromString("--expose-gc");
    const gc = vm.runInNewContext("gc") as () => void;

    /** Collects the garbage, the WeakRef targets are released after the current job. */
    const collect = async () => {
        await new Promise((resolve) => setImmediate(resolve));
        gc();
        await new Promise((resolve) => setImmediate(resolve));
        gc();
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const heapItems = (ctx: TestContext) => (ctx as any)._timers._items as { callback?: unknown; tag?: unknown }[];

    it("drops the cancelled timers on top before they expire", () => {
        const ctx = new TestContext();
        for (let i = 0; i < 40; i++) {
            ctx.delay(1, () => {}, "short");
        }
        // fewer than the compaction threshold
        const cancels = Array.from({ length: 20 }, () => ctx.delay(1000, () => {}, "long"));
        cancels.forEach((cancel) => cancel());
        ctx.update(1);
        assert.equal(heapItems(ctx).length, 0);
    });

    it("compacts after the update when the cancelled timers are many", () => {
        const ctx = new TestContext();
        for (let i = 0; i < 100; i++) {
            ctx.delay(1, () => {}, "short");
        }
        const cancels = Array.from({ length: 40 }, () => ctx.delay(1000, () => {}, "long"));
        ctx.delay(500, () => {}, "live");
        cancels.forEach((cancel) => cancel());
        ctx.update(1);
        // the live timer is on top, the cancelled ones behind it are compacted
        assert.equal(heapItems(ctx).length, 1);
    });

    it("releases the callback and tag of a cancelled timer left in the heap", () => {
        const ctx = new TestContext();
        ctx.delay(1, () => {}, "live");
        const cancel = ctx.delay(1000, () => {}, {});
        cancel();
        const items = heapItems(ctx);
        assert.equal(items.length, 2);
        assert.ok(items.some((v) => v.callback === undefined && v.tag === undefined));
    });

    it("lets the owners of the cancelled timers be collected", async () => {
        const ctx = new TestContext();
        for (let i = 0; i < 1000; i++) {
            ctx.delay(1, () => {}, "short");
        }
        const refs: WeakRef<object>[] = [];
        const cancels = Array.from({ length: 500 }, () => {
            const owner = { data: [1, 2, 3] };
            refs.push(new WeakRef(owner));
            return ctx.delay(1000, () => owner.data.length, owner);
        });
        cancels.forEach((cancel) => cancel());
        ctx.update(1);
        await collect();
        assert.equal(refs.filter((ref) => ref.deref()).length, 0);
    });

    it("lets a fired timer's callback be collected while its cancel function is kept", async () => {
        const ctx = new TestContext();
        let ref: WeakRef<object> | undefined;
        const cancel = (() => {
            const owner = {};
            ref = new WeakRef(owner);
            return ctx.delay(1, () => owner, "t");
        })();
        ctx.update(1);
        await collect();
        assert.equal(ref!.deref(), undefined);
        cancel();
    });

    it("lets a removed listener's target and callback be collected while its cancel function is kept", async () => {
        const ctx = new TestContext();
        const refs: WeakRef<object>[] = [];
        const cancels = [0, 1].map((i) => {
            const target = {};
            const owner = {};
            refs.push(new WeakRef(target), new WeakRef(owner));
            return ctx.on("e", target, () => owner, i === 0 ? "a" : "b");
        });
        ctx.offAll("a");
        cancels[1]();
        await collect();
        assert.equal(refs.filter((ref) => ref.deref()).length, 0);
        cancels.forEach((cancel) => cancel());
    });
});

describe("context tag index", () => {
    it("moves a listener registered again to its new tag", () => {
        const ctx = new TestContext();
        const log: string[] = [];
        const callback = () => log.push("a");
        const cancelOld = ctx.on("e", callback, "x");
        ctx.on("e", callback, "y");
        ctx.offAll("x");
        cancelOld();
        ctx.dispatch("e");
        assert.deepEqual(log, ["a"]);
        ctx.offAll("y");
        ctx.dispatch("e");
        assert.deepEqual(log, ["a"]);
        assert.equal(ctx.listenerCount("e"), 0);
    });

    it("off removes the listeners of the tag on that event only", () => {
        const ctx = new TestContext();
        const log: string[] = [];
        ctx.on("e1", () => log.push("e1"), "x");
        ctx.on("e2", () => log.push("e2"), "x");
        ctx.delay(1, () => log.push("timer"), "x");
        ctx.off("e1", "x");
        ctx.dispatch("e1");
        ctx.dispatch("e2");
        ctx.update(1);
        assert.deepEqual(log, ["e2", "timer"]);
    });

    it("offAll during a dispatch lets the remaining listeners of other tags run", () => {
        const ctx = new TestContext();
        const log: string[] = [];
        ctx.on("e", () => {
            log.push("a");
            ctx.offAll("x");
        }, "y");
        ctx.on("e", () => log.push("x1"), "x");
        ctx.on("e", () => log.push("b"), "y");
        ctx.dispatch("e");
        assert.deepEqual(log, ["a", "b"]);
    });

    it("forgets a tag once it has nothing left", () => {
        const ctx = new TestContext();
        const tag = {};
        const cancel = ctx.on("e", () => {}, tag);
        ctx.delay(1, () => {}, tag);
        cancel();
        ctx.update(1);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        assert.equal((ctx as any)._subscriptions.has(tag), false);
    });
});

describe("WaitForEvent listener", () => {
    it("doesn't remove an independent Listen when aborted", () => {
        const ctx = new TestContext();
        const tree = ctx.createTree(
            n("Sequence", "root", {
                children: [
                    n("Listen", "listen", { args: { event: "go" }, children: [probe("cb")] }),
                    n("Timeout", "to", {
                        args: { time: 1 },
                        children: [n("WaitForEvent", "w", { args: { event: "go" } })],
                    }),
                ],
            }),
        );
        tree.tick();
        ctx.update(1);
        assert.equal(tree.tick(), "failure");
        ctx.dispatch("go");
        assert.deepEqual(ctx.takeLog(), ["tick:cb"]);
        assert.equal(ctx.listenerCount("go"), 1);
    });

    it("lets two WaitForEvent wait for the same event", () => {
        const ctx = new TestContext();
        const tree = ctx.createTree(
            n("Parallel", "root", {
                children: [
                    n("WaitForEvent", "a", { args: { event: "go" } }),
                    n("WaitForEvent", "b", { args: { event: "go" } }),
                ],
            }),
        );
        assert.equal(tree.tick(), "running");
        ctx.dispatch("go");
        assert.equal(tree.tick(), "success");
        assert.equal(ctx.listenerCount("go"), 0);
    });

    it("keeps the Listen when the event arrives", () => {
        const ctx = new TestContext();
        const tree = ctx.createTree(
            n("Sequence", "root", {
                children: [
                    n("Listen", "listen", { args: { event: "go" }, children: [probe("cb")] }),
                    n("WaitForEvent", "w", { args: { event: "go" } }),
                ],
            }),
        );
        tree.tick();
        ctx.dispatch("go");
        assert.equal(tree.tick(), "success");
        ctx.dispatch("go");
        assert.deepEqual(ctx.takeLog(), ["tick:cb", "tick:cb"]);
    });
});

describe("node registration", () => {
    it("registers the builtin nodes", () => {
        const ctx = new TestContext();
        const names = getNodeDescriptors().map((v) => v.name);
        for (const name of ["Sequence", "Selector", "Parallel", "Check", "Wait", "Listen", "Math"]) {
            assert.ok(names.includes(name), name);
            assert.ok(ctx.nodeDefs[name], name);
            assert.ok(ctx.nodeCtors[name], name);
        }
        assert.equal(names.includes("Watchdog"), false);
        assert.equal(ctx.nodeDefs.Selector.preemptive, true);
    });

    it("registers the builtin Core nodes only when Core is supported", () => {
        const core = new TestContext();
        const other = new GroupContext();
        for (const { name, group } of getNodeDescriptors()) {
            if (name !== "GroupOnly") {
                assert.deepEqual(group, ["Core"], name);
                assert.ok(core.nodeDefs[name], name);
                assert.equal(other.nodeDefs[name], undefined, name);
            }
        }
    });

    it("only registers the nodes of the supported groups", () => {
        assert.equal(new TestContext().nodeDefs.GroupOnly, undefined);
        const ctx = new GroupContext();
        assert.ok(ctx.nodeDefs.GroupOnly);
        assert.equal(ctx.createTree(n("GroupOnly", "g")).tick(), "success");
    });

    it("throws when a node is registered twice", () => {
        assert.throws(() => registerNode(GroupOnly), /node GroupOnly already registered/);
    });

    it("trims the indent of the doc", () => {
        const ctx = new TestContext();
        class Doc extends Node {
            override onTick(): Status {
                return "success";
            }

            static override get descriptor(): NodeDef {
                return {
                    name: "Doc",
                    type: "Action",
                    group: ["Test"],
                    desc: "doc",
                    doc: `
                        + line 1
                          + line 2
                    `,
                };
            }
        }
        ctx.registerNode(Doc);
        assert.equal(ctx.nodeDefs.Doc.doc, "+ line 1\n  + line 2\n");
        assert.equal(ctx.nodeDefs.Invert.doc?.startsWith("+ 只能有一个子节点"), true);
    });
});
