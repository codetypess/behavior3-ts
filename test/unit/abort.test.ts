import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Node, NodeDef, Status, Tree, TreeEvent } from "../../src/behavior3";
import { captureConsole, cond, n, Probe, probe, TestContext } from "./helpers";

describe("abort", () => {
    it("aborts the running descendants before the node itself", () => {
        const ctx = new TestContext();
        const tree = ctx.createTree(
            n("Group", "outer", { children: [n("Group", "inner", { children: [probe("a")] }), probe("b")] }),
        );
        tree.blackboard.set("a", "running");
        tree.tick();
        ctx.takeLog();

        tree.root!.abort(tree);
        assert.deepEqual(ctx.takeLog(), ["abort:a", "abort:inner", "abort:outer"]);
        assert.equal(tree.isRunning(tree.root!), false);
        assert.equal(tree.isRunning(tree.root!.children[0]), false);
    });

    it("does nothing on a node which is not running", () => {
        const ctx = new TestContext();
        const tree = ctx.createTree(n("Group", "g", { children: [probe("a"), probe("b")] }));
        tree.blackboard.set("b", "running");
        tree.tick();
        ctx.takeLog();
        // a has finished, only b is running
        tree.root!.abort(tree);
        assert.deepEqual(ctx.takeLog(), ["abort:b", "abort:g"]);
        tree.root!.abort(tree);
        assert.deepEqual(ctx.takeLog(), []);
    });

    it("restarts the aborted branch from the beginning", () => {
        const ctx = new TestContext();
        const tree = ctx.createTree(
            n("Timeout", "t", {
                args: { time: 1 },
                children: [n("Sequence", "seq", { children: [n("Wait", "w", { args: { time: 5 } }), probe("a")] })],
            }),
        );
        const wait = tree.root!.children[0].children[0];
        assert.equal(tree.tick(), "running");
        assert.equal(tree.getState(wait), 5);
        ctx.update(1);
        assert.equal(tree.tick(), "failure");
        assert.equal(tree.isRunning(wait), false);

        // the aborted Wait starts a new wait, instead of reusing the old expired time
        assert.equal(tree.tick(), "running");
        assert.equal(tree.getState(wait), 6);
    });

    it("aborts the running children left behind by a finished node", () => {
        const ctx = new TestContext();
        const tree = ctx.createTree(n("Leaky", "leaky", { children: [probe("a")] }));
        tree.blackboard.set("a", "running");
        assert.equal(tree.tick(), "success");
        assert.deepEqual(ctx.takeLog(), ["tick:a", "abort:a"]);
        assert.equal(tree.isRunning(tree.root!.children[0]), false);
    });

    it("Switch aborts the running action of the case", () => {
        const ctx = new TestContext();
        const tree = ctx.createTree(
            n("Switch", "sw", { children: [n("Case", "case", { children: [probe("c"), probe("a")] })] }),
        );
        tree.blackboard.set("a", "running");
        tree.tick();
        ctx.takeLog();
        tree.root!.abort(tree);
        assert.deepEqual(ctx.takeLog(), ["abort:a"]);
        assert.equal(tree.isRunning(tree.root!.children[0].children[1]), false);
    });

    it("WaitForEvent removes its listener when aborted", () => {
        const ctx = new TestContext();
        const tree = ctx.createTree(
            n("Timeout", "t", { args: { time: 1 }, children: [n("WaitForEvent", "w", { args: { event: "go" } })] }),
        );
        tree.tick();
        assert.equal(ctx.listenerCount("go"), 1);
        ctx.update(1);
        assert.equal(tree.tick(), "failure");
        assert.equal(ctx.listenerCount("go"), 0);
    });

    it("catches errors thrown in onAbort", () => {
        const ctx = new TestContext();
        const tree = ctx.createTree(n("Timeout", "t", { args: { time: 1 }, children: [probe("a")] }));
        const probeNode = tree.root!.children[0];
        probeNode.onAbort = () => {
            throw new Error("abort failed");
        };
        tree.blackboard.set("a", "running");
        tree.tick();
        ctx.update(1);
        const { result, error } = captureConsole(() => tree.tick());
        assert.equal(result, "failure");
        assert.match(error[0], /abort failed/);
        assert.equal(tree.isRunning(probeNode), false);
    });

    it("forbids overriding abort", () => {
        const ctx = new TestContext();
        class BadProbe extends Probe {
            override abort() {}
            static override get descriptor() {
                return { ...Probe.descriptor, name: "BadProbe" };
            }
        }
        ctx.registerNode(BadProbe);
        assert.throws(() => ctx.createTree(n("BadProbe", "bad")), /don't override 'abort'/);
    });
});

describe("interrupt", () => {
    it("aborts all running nodes and clears the states", () => {
        const ctx = new TestContext();
        const tree = ctx.createTree(
            n("Parallel", "par", {
                children: [n("Group", "g", { children: [probe("a")] }), n("WaitForEvent", "w", { args: { event: "go" } })],
            }),
        );
        tree.blackboard.set("a", "running");
        tree.tick();
        ctx.takeLog();
        assert.equal(ctx.listenerCount("go"), 1);

        tree.interrupt();
        assert.equal(tree.status, "interrupted");
        assert.deepEqual(ctx.takeLog(), ["abort:a", "abort:g"]);
        assert.equal(ctx.listenerCount("go"), 0);
        for (const node of [tree.root!, ...tree.root!.children]) {
            assert.equal(tree.isRunning(node), false);
        }

        // starts from the beginning
        tree.tick();
        assert.deepEqual(ctx.takeLog(), ["tick:a"]);
    });

    it("interrupts after the current tick when called in a node", () => {
        const ctx = new TestContext();
        const tree = ctx.createTree(
            n("Parallel", "par", { children: [n("Group", "g", { children: [probe("a")] }), n("Interrupt", "i"), probe("b")] }),
        );
        tree.blackboard.set("a", "running");
        assert.equal(tree.tick(), "interrupted");
        // the tick is unwound right after the interrupt, b is not ticked
        assert.deepEqual(ctx.takeLog(), ["tick:a", "abort:a", "abort:g"]);
        assert.equal(tree.isRunning(tree.root!), false);
    });

    for (const operation of ["interrupt", "clear"] as const) {
        it(`aborts a node first returning running after a synchronous ${operation}`, () => {
            const ctx = new TestContext();
            const tree = ctx.createTree(
                n("Parallel", "par", { children: [probe("active"), probe("after")] }),
            );
            const active = tree.root!.children[0];
            let resources = 0;
            ctx.on("started", () => tree[operation](), "test");
            active.onTick = (t) => {
                // A host operation can synchronously interrupt the tree before this first
                // running return. The node relies on automatic running tracking, not setState.
                resources++;
                ctx.log.push("start:active");
                t.context.dispatch("started");
                ctx.log.push("return:running");
                return "running";
            };
            active.onAbort = () => {
                resources--;
                ctx.log.push("abort:active");
            };

            // Each run releases its resource once, after onTick returns; the sibling never runs.
            for (let i = 0; i < 2; i++) {
                assert.equal(tree.tick(), "interrupted");
                assert.deepEqual(ctx.takeLog(), ["start:active", "return:running", "abort:active"]);
                assert.equal(resources, 0);
                assert.equal(tree.isRunning(active), false);
                assert.equal(tree.isRunning(tree.root!), false);
                assert.equal(tree.status, operation === "clear" ? "success" : "interrupted");
            }
        });
    }

    it("an exception stops the tick and returns exception", () => {
        const ctx = new TestContext();
        const tree = ctx.createTree(n("Sequence", "seq", { children: [probe("a"), n("Throw", "t"), probe("b")] }));
        const { result, error } = captureConsole(() => tree.tick());
        assert.equal(result, "exception");
        assert.match(error[0], /boom/);
        assert.deepEqual(ctx.takeLog(), ["tick:a"]);
        assert.equal(tree.isRunning(tree.root!), false);
    });

    it("dispatches EXCEPTION with the error and the node, then INTERRUPTED", () => {
        const ctx = new TestContext();
        const tree = ctx.createTree(n("Selector", "sel", { children: [n("Throw", "x"), probe("b")] }));
        const events: string[] = [];
        ctx.on(TreeEvent.EXCEPTION, tree, (error: Error, node: Node) => events.push(`exception:${node.id}:${error.message}`), "test");
        ctx.on(TreeEvent.INTERRUPTED, tree, () => events.push("interrupted"), "test");
        const { result, error } = captureConsole(() => tree.tick());
        assert.equal(result, "exception");
        assert.match(error[0], /Throw#x: Error: boom/);
        assert.deepEqual(events, ["exception:x:boom", "interrupted"]);
        // the Selector doesn't take the exception as a failure and fall back to the next child
        assert.deepEqual(ctx.takeLog(), []);
    });

    it("prints the location of the node once", () => {
        const ctx = new TestContext();
        const thrown = ctx.createTree(probe("x"));
        const node = thrown.root!;
        node.onTick = () => node.throw("bad data");
        const e1 = captureConsole(() => thrown.tick()).error[0];
        assert.match(e1, /^Error: test-tree-\d+->Probe#x: bad data/);
        assert.equal(e1.match(/Probe#x/g)!.length, 1);

        // an error not thrown by node.throw gets the location
        const plain = ctx.createTree(n("Throw", "t"));
        const e2 = captureConsole(() => plain.tick()).error[0];
        assert.match(e2, /^test-tree-\d+->Throw#t: Error: boom/);
    });

    it("wraps a thrown value which is not an Error", () => {
        const ctx = new TestContext();
        const tree = ctx.createTree(probe("a"));
        tree.root!.onTick = () => {
            throw "oops";
        };
        let received: unknown;
        ctx.on(TreeEvent.EXCEPTION, tree, (error: Error) => (received = error), "test");
        const { result } = captureConsole(() => tree.tick());
        assert.equal(result, "exception");
        assert.ok(received instanceof Error);
        assert.equal((received as Error).message, "oops");
    });

    it("dispatches INTERRUPTED only when running", () => {
        const ctx = new TestContext();
        const tree = ctx.createTree(probe("a"));
        let count = 0;
        ctx.on("treeInterrupted", tree, () => count++, "test");
        tree.tick();
        tree.interrupt();
        assert.equal(count, 0);
        assert.equal(tree.status, "success");
        tree.blackboard.set("a", "running");
        tree.tick();
        tree.interrupt();
        assert.equal(count, 1);
    });

    it("clear resets the tree", () => {
        const ctx = new TestContext();
        const tree = ctx.createTree(
            n("Sequence", "seq", {
                children: [n("Listen", "l", { args: { event: "e" }, children: [probe("x")] }), probe("a")],
            }),
        );
        tree.blackboard.set("a", "running");
        tree.tick();
        ctx.takeLog();
        tree.clear();
        assert.deepEqual(ctx.takeLog(), ["abort:a"]);
        assert.equal(tree.status, "success");
        assert.deepEqual(tree.blackboard.values, {});
        assert.equal(ctx.listenerCount("e"), 0);
    });

    it("aborts running nodes in condition trees", () => {
        const ctx = new TestContext();
        // the condition tree is interrupted while it has a running node
        const condition = n("Parallel", "cp", {
            children: [n("Group", "cg", { children: [probe("p", { args: { status: "running" } })] }), n("Interrupt", "i")],
        });
        const tree = ctx.createTree(n("Sequence", "seq", { children: [probe("a", { conditions: [cond(condition)] })] }));
        assert.equal(tree.tick(), "interrupted");
        assert.deepEqual(ctx.takeLog(), ["tick:p", "abort:p", "abort:cg"]);
        const cg = tree.root!.children[0].conditions[0].root.children[0];
        assert.equal(tree.isRunning(cg), false);
    });
});

describe("exceptions", () => {
    it("the exception status is only for the tick with the exception", () => {
        const ctx = new TestContext();
        const tree = ctx.createTree(n("Sequence", "seq", { children: [probe("a"), probe("b")] }));
        tree.blackboard.set("a", "running");
        tree.tick();
        const probeNode = tree.root!.children[0];
        const onTick = probeNode.onTick;
        // the exception wins over an interrupt in the same tick
        probeNode.onTick = (t) => {
            t.interrupt();
            throw new Error("boom");
        };
        assert.equal(captureConsole(() => tree.tick()).result, "exception");
        assert.equal(tree.status, "exception");
        assert.equal(tree.isRunning(tree.root!), false);

        probeNode.onTick = onTick;
        assert.equal(tree.tick(), "running");
        tree.interrupt();
        assert.equal(tree.status, "interrupted");
    });

    // a: running main branch; the callback runs Selector(Throw, fallback)
    const listenTree = (child = n("Selector", "sel", { children: [n("Throw", "t"), probe("fallback")] })) =>
        n("Sequence", "seq", {
            children: [
                n("Once", "once", { children: [n("Listen", "l", { args: { event: "e" }, children: [child] })] }),
                probe("main", { args: { status: "running" } }),
            ],
        });

    it("an error in a callback only stops the subtree of the callback", () => {
        const ctx = new TestContext();
        const tree = ctx.createTree(listenTree());
        const events: string[] = [];
        ctx.on(TreeEvent.EXCEPTION, tree, (_: Error, node: Node) => events.push(`exception:${node.id}`), "test");
        ctx.on(TreeEvent.INTERRUPTED, tree, () => events.push("interrupted"), "test");
        tree.tick();
        ctx.takeLog();

        const { error } = captureConsole(() => ctx.dispatch("e"));
        assert.match(error[0], /boom/);
        assert.deepEqual(events, ["exception:t"]);
        // no fallback, and the main branch is still running
        assert.deepEqual(ctx.takeLog(), []);
        assert.equal(tree.status, "running");
        assert.equal(tree.isRunning(tree.root!.children[1]), true);

        assert.equal(tree.tick(), "running");
        assert.deepEqual(ctx.takeLog(), ["tick:main"]);
        // the listener still works
        captureConsole(() => ctx.dispatch("e"));
        assert.deepEqual(events, ["exception:t", "exception:t"]);
    });

    it("aborts the running nodes of the callback subtree", () => {
        const ctx = new TestContext();
        const child = n("Parallel", "par", {
            children: [n("Group", "g", { children: [probe("p", { args: { status: "running" } })] }), n("Throw", "t")],
        });
        const tree = ctx.createTree(listenTree(child));
        tree.tick();
        ctx.takeLog();
        captureConsole(() => ctx.dispatch("e"));
        assert.deepEqual(ctx.takeLog(), ["tick:p", "abort:p", "abort:g"]);
        const par = tree.root!.children[0].children[0].children[0];
        for (const node of [par, ...par.children, par.children[0].children[0]]) {
            assert.equal(tree.isRunning(node), false);
        }
        assert.equal(tree.isRunning(tree.root!.children[1]), true);
    });

    it("an error in a Delay callback doesn't affect the tree", () => {
        const ctx = new TestContext();
        const tree = ctx.createTree(
            n("Sequence", "seq", {
                children: [
                    n("Delay", "d", { args: { delay: 1 }, children: [n("Throw", "t")] }),
                    probe("main", { args: { status: "running" } }),
                ],
            }),
        );
        tree.tick();
        ctx.takeLog();
        const { error } = captureConsole(() => ctx.update(1));
        assert.match(error[0], /boom/);
        assert.equal(tree.status, "running");
        assert.equal(tree.tick(), "running");
    });

    it("an error in a callback dispatched during a tick doesn't affect the tick", () => {
        const ctx = new TestContext();
        const tree = ctx.createTree(
            n("Sequence", "seq", {
                children: [
                    n("Once", "once", { children: [n("Listen", "l", { args: { event: "e" }, children: [n("Throw", "t")] })] }),
                    n("Emit", "emit", { args: { event: "e" } }),
                    probe("a"),
                ],
            }),
        );
        const { result, error } = captureConsole(() => tree.tick());
        assert.match(error[0], /boom/);
        assert.equal(result, "success");
        assert.deepEqual(ctx.takeLog(), ["tick:a"]);
    });

    it("interrupt in a callback interrupts the tree after the callback", () => {
        const ctx = new TestContext();
        const tree = ctx.createTree(listenTree(n("Sequence", "s", { children: [n("Interrupt", "i"), probe("after")] })));
        tree.tick();
        ctx.takeLog();
        ctx.dispatch("e");
        assert.deepEqual(ctx.takeLog(), ["abort:main"]);
        assert.equal(tree.status, "interrupted");
    });

    it("interrupt in a callback dispatched during a tick interrupts at the end of the tick", () => {
        const ctx = new TestContext();
        const tree = ctx.createTree(
            n("Sequence", "seq", {
                children: [
                    n("Once", "once", {
                        children: [n("Listen", "l", { args: { event: "e" }, children: [n("Interrupt", "i")] })],
                    }),
                    n("Emit", "emit", { args: { event: "e" } }),
                    probe("a"),
                ],
            }),
        );
        assert.equal(tree.tick(), "interrupted");
        assert.deepEqual(ctx.takeLog(), []);
    });

    // outer callback: Sequence(Emit inner, after); inner callback: the given node
    const nestedTree = (inner: ReturnType<typeof n>) =>
        n("Sequence", "seq", {
            children: [
                n("Once", "o1", {
                    children: [
                        n("Listen", "l1", {
                            args: { event: "outer" },
                            children: [
                                n("Sequence", "s", {
                                    children: [n("Emit", "emit", { args: { event: "inner" } }), probe("after")],
                                }),
                            ],
                        }),
                    ],
                }),
                n("Once", "o2", { children: [n("Listen", "l2", { args: { event: "inner" }, children: [inner] })] }),
                probe("main", { args: { status: "running" } }),
            ],
        });

    it("an error in a nested callback only stops the inner callback", () => {
        const ctx = new TestContext();
        const tree = ctx.createTree(nestedTree(n("Throw", "t")));
        tree.tick();
        ctx.takeLog();
        const { error } = captureConsole(() => ctx.dispatch("outer"));
        assert.match(error[0], /boom/);
        assert.deepEqual(ctx.takeLog(), ["tick:after"]);
        assert.equal(tree.status, "running");
    });

    it("interrupt in a nested callback interrupts the tree after the outer callback", () => {
        const ctx = new TestContext();
        const tree = ctx.createTree(nestedTree(n("Interrupt", "i")));
        tree.tick();
        ctx.takeLog();
        ctx.dispatch("outer");
        // the outer callback is unwound, then the tree is interrupted
        assert.deepEqual(ctx.takeLog(), ["abort:main"]);
        assert.equal(tree.status, "interrupted");
    });
});

/** Switches to the next child every tick without aborting the running one. */
class Switcher extends Node {
    override onTick(tree: Tree<TestContext, unknown>): Status {
        const i = ((tree.getState<number>(this) ?? -1) + 1) % this.children.length;
        this.children[i].tick(tree);
        tree.setState(this, i);
        return "running";
    }

    static override get descriptor(): NodeDef {
        return { name: "Switcher", type: "Composite", group: ["Test"], desc: "leaks the running child", children: -1 };
    }
}

describe("missing abort check", () => {
    const missing = (warn: string[]) => warn.filter((v) => v.includes("missing abort"));

    it("warns about the running node left behind in debug mode", () => {
        const ctx = new TestContext();
        ctx.registerNode(Switcher);
        const tree = ctx.createTree(
            n("Switcher", "sw", { children: [probe("a", { args: { status: "running" } }), probe("b")] }),
        );
        tree.debug = true;
        assert.deepEqual(missing(captureConsole(() => tree.tick()).warn), []);
        const { warn } = captureConsole(() => tree.tick());
        assert.equal(missing(warn).length, 1);
        assert.match(missing(warn)[0], /Probe#a: still running but not ticked/);

        // not checked without debug
        tree.debug = false;
        tree.tick();
        assert.deepEqual(missing(captureConsole(() => tree.tick()).warn), []);
    });

    it("no warning for the builtin nodes", () => {
        const ctx = new TestContext();
        const tree = ctx.createTree(
            n("Selector", "sel", {
                children: [
                    probe("high", { conditions: [cond(probe("enemy"), "both")] }),
                    n("Parallel", "par", {
                        children: [
                            n("Timeout", "t", { args: { time: 2 }, children: [n("Wait", "w", { args: { time: 5 } })] }),
                            n("Race", "race", { children: [n("WaitForEvent", "e", { args: { event: "go" } }), probe("r")] }),
                        ],
                    }),
                ],
            }),
        );
        tree.debug = true;
        tree.blackboard.set("enemy", "failure");
        tree.blackboard.set("r", "running");
        const warn: string[] = [];
        for (let i = 0; i < 4; i++) {
            warn.push(...captureConsole(() => tree.tick()).warn);
            ctx.update(1);
        }
        tree.blackboard.set("enemy", "success");
        tree.blackboard.set("high", "running");
        warn.push(...captureConsole(() => tree.tick()).warn);
        assert.equal(tree.isRunning(tree.root!.children[0]), true);
        assert.deepEqual(missing(warn), []);
    });
});

describe("clear while executing", () => {
    const spy = (id: string, status?: Status) =>
        n("ClearSpy", id, { args: status ? { status } : {} });
    const clearNow = (id: string) => n("ClearNow", id);
    const logEvents = (ctx: TestContext, tree: Tree<TestContext, unknown>) => {
        ctx.on(TreeEvent.CLEANED, tree, () => ctx.log.push("CLEANED"), tree);
        ctx.on(TreeEvent.INTERRUPTED, tree, () => ctx.log.push("INTERRUPTED"), tree);
    };

    it("aborts the running nodes before onClear when cleared in a tick", () => {
        const ctx = new TestContext();
        const tree = ctx.createTree(
            n("Parallel", "root", { children: [spy("active", "running"), clearNow("c")] }),
        );
        logEvents(ctx, tree);
        assert.equal(tree.tick(), "interrupted");
        assert.deepEqual(ctx.takeLog(), [
            "tick:active",
            "clearNow:c",
            "CLEANED",
            "INTERRUPTED",
            "abort:active",
            "clear:active",
        ]);
        assert.equal(tree.status, "success");
        assert.equal(tree.isRunning(tree.root!), false);
        assert.equal(ctx.listenerCount(TreeEvent.CLEANED), 0);
    });

    it("doesn't run the rest of the tick", () => {
        const ctx = new TestContext();
        const tree = ctx.createTree(n("Sequence", "root", { children: [clearNow("c"), spy("after")] }));
        tree.tick();
        assert.deepEqual(ctx.takeLog(), ["clearNow:c", "clear:after"]);
    });

    it("clears the variables after the tick exits", () => {
        const ctx = new TestContext();
        const tree = ctx.createTree(
            n("Sequence", "root", {
                children: [clearNow("c"), n("Let", "l", { args: { value: 1 }, output: ["x"] })],
            }),
        );
        tree.blackboard.set("y", 1);
        tree.tick();
        assert.deepEqual(Object.keys(tree.blackboard.values), []);
    });

    it("clears a running tree in a callback after the callback exits", () => {
        const ctx = new TestContext();
        const tree = ctx.createTree(
            n("Parallel", "root", {
                children: [
                    n("Listen", "listen", {
                        args: { event: "hit" },
                        children: [n("Sequence", "cb", { children: [clearNow("c"), spy("after")] })],
                    }),
                    spy("active", "running"),
                ],
            }),
        );
        tree.tick();
        ctx.takeLog();
        logEvents(ctx, tree);
        ctx.dispatch("hit");
        assert.deepEqual(ctx.takeLog(), [
            "clearNow:c",
            "CLEANED",
            "INTERRUPTED",
            "abort:active",
            "clear:after",
            "clear:active",
        ]);
        assert.equal(tree.status, "success");
        assert.equal(ctx.listenerCount("hit"), 0);
    });

    it("stops the rest of a callback of an idle tree", () => {
        const ctx = new TestContext();
        const tree = ctx.createTree(
            n("Listen", "listen", {
                args: { event: "hit" },
                children: [
                    n("Parallel", "cb", { children: [spy("active", "running"), clearNow("c"), spy("after")] }),
                ],
            }),
        );
        tree.tick();
        ctx.dispatch("hit");
        assert.deepEqual(ctx.takeLog(), [
            "tick:active",
            "clearNow:c",
            "abort:active",
            "clear:active",
            "clear:after",
        ]);
        assert.equal(ctx.listenerCount("hit"), 0);
    });

    it("clears a subtree cleared in its own tick, the caller goes on", () => {
        const ctx = new TestContext();
        ctx.defineTree("sub", n("Parallel", "sub-root", { children: [spy("sub-active", "running"), clearNow("c")] }));
        const tree = ctx.createTree(
            n("Selector", "root", {
                children: [n("RunTree", "call", { args: { path: "sub" } }), probe("fallback")],
            }),
        );
        assert.equal(tree.tick(), "success");
        assert.deepEqual(ctx.takeLog(), [
            "tick:sub-active",
            "clearNow:c",
            "abort:sub-active",
            "clear:sub-active",
            "tick:fallback",
        ]);
    });

    it("lets a Delay callback restore its cached variables before the clear", () => {
        const ctx = new TestContext();
        const tree = ctx.createTree(
            n("Delay", "delay", { args: { delay: 1, cacheVars: ["x"] }, children: [clearNow("c")] }),
        );
        tree.blackboard.set("x", 1);
        assert.equal(tree.tick(), "success");
        tree.blackboard.set("x", 9);
        ctx.update(1);
        assert.deepEqual(ctx.takeLog(), ["clearNow:c"]);
        assert.deepEqual(Object.keys(tree.blackboard.values), []);
    });

    it("clears after the rest of a bound callback, from the root blackboard", () => {
        const ctx = new TestContext();
        const tree = ctx.createTree(
            n("Sequence", "root", {
                children: [
                    n("Scope", "s", {
                        children: [
                            n("Sequence", "init", {
                                children: [
                                    n("Let", "l", { args: { value: 1 }, output: ["x"] }),
                                    n("Listen", "listen", { args: { event: "hit" }, children: [clearNow("c")] }),
                                ],
                            }),
                        ],
                    }),
                    n("ClearSpy", "main", { args: { key: "x", status: "running" } }),
                ],
            }),
        );
        tree.blackboard.set("x", 9);
        assert.equal(tree.tick(), "running");
        ctx.takeLog();
        ctx.dispatch("hit");
        assert.deepEqual(ctx.takeLog(), ["clearNow:c", "abort:main", "clear:main=9"]);
        assert.equal(tree.blackboard, tree.__rootBlackboard);
    });

    it("waits for the outermost bound callback, clears once", () => {
        const ctx = new TestContext();
        const tree = ctx.createTree(probe("p", { args: { status: "running" } }));
        tree.tick();
        ctx.takeLog();
        ctx.on(TreeEvent.CLEANED, tree, () => ctx.log.push("CLEANED"), tree);
        const inner = tree.bindCallback(() => {
            tree.clear();
            ctx.log.push("inner done");
        });
        const outer = tree.bindCallback(() => {
            inner();
            tree.clear();
            ctx.log.push("outer done");
            // still executing: the tree is not cleared yet, and can't be ticked
            assert.throws(() => tree.tick(), /is executing \(a callback, an abort or a clear\)/);
        });
        outer();
        assert.deepEqual(ctx.takeLog(), ["inner done", "outer done", "CLEANED", "abort:p"]);
        assert.equal(tree.status, "success");
    });

    it("logs a listener throwing in the tick, the tick goes on", () => {
        const ctx = new TestContext();
        const tree = ctx.createTree(probe("p"));
        const events: string[] = [];
        ctx.on(TreeEvent.TICKED, tree, () => {
            throw new Error("boom");
        }, tree);
        ctx.on(TreeEvent.TICKED, tree, () => events.push("after"), "other");
        const { result, error } = captureConsole(() => tree.tick());
        assert.equal(result, "success");
        assert.equal(error.length, 1);
        assert.match(error[0], /a listener of 'treeTicked' of tree '.*' threw: Error: boom/);
        assert.deepEqual(events, ["after"]);
        assert.equal(tree.ticking, false);
        assert.equal(tree.blackboard, tree.__rootBlackboard);
    });

    for (const event of [TreeEvent.CLEANED, TreeEvent.INTERRUPTED]) {
        it(`clears the tree when a ${event} listener throws`, () => {
            const ctx = new TestContext();
            const tree = ctx.createTree(
                n("Sequence", "s", {
                    children: [
                        n("BindListen", "bl", { args: { event: "e", key: "x" } }),
                        probe("p", { args: { status: "running" } }),
                    ],
                }),
            );
            assert.equal(tree.tick(), "running");
            ctx.takeLog();
            ctx.on(event, tree, () => {
                throw new Error("boom");
            }, "test");
            ctx.on(event, tree, () => ctx.log.push("next listener"), "test");
            const { error } = captureConsole(() => tree.clear());
            assert.equal(error.length, 1);
            assert.match(error[0], new RegExp(`a listener of '${event}' of tree '.*' threw: Error: boom`));
            assert.deepEqual(ctx.takeLog(), ["next listener", "abort:p"]);
            assert.equal(tree.isRunning(tree.root!), false);
            ctx.dispatch("e");
            assert.deepEqual(ctx.takeLog(), []);
        });
    }

    it("stops the tick once when an EXCEPTION listener throws", () => {
        const ctx = new TestContext();
        const tree = ctx.createTree(n("Sequence", "s1", { children: [n("Sequence", "s2", { children: [n("Throw", "t")] })] }));
        ctx.on(TreeEvent.EXCEPTION, tree, () => {
            throw new Error("listener boom");
        }, "test");
        const { result, error } = captureConsole(() => tree.tick());
        assert.equal(result, "exception");
        // the node exception, then the listener: not thrown again by every ancestor
        assert.equal(error.length, 2);
        assert.match(error[0], /Throw#t: Error: boom/);
        assert.match(error[1], /a listener of 'treeException' of tree '.*' threw: Error: listener boom/);
        assert.equal(tree.ticking, false);
    });

    /** Parallel of two running ClearSpy, `A.onAbort` runs `fn` after logging. */
    const abortCalls = (fn: (tree: Tree<TestContext, unknown>) => void) => {
        const ctx = new TestContext();
        const tree = ctx.createTree(
            n("Parallel", "par", {
                children: [
                    n("ClearSpy", "A", { args: { status: "running" } }),
                    n("ClearSpy", "B", { args: { status: "running" } }),
                ],
            }),
        );
        assert.equal(tree.tick(), "running");
        const a = tree.root!.children[0];
        const onAbort = a.onAbort.bind(a);
        a.onAbort = (t) => {
            onAbort(t);
            fn(t as Tree<TestContext, unknown>);
        };
        ctx.takeLog();
        return { ctx, tree };
    };

    it("clears after aborting every running node when onAbort clears in an interrupt", () => {
        const { ctx, tree } = abortCalls((t) => t.clear());
        tree.interrupt();
        assert.deepEqual(ctx.takeLog(), ["abort:A", "abort:B", "clear:A", "clear:B"]);
        assert.equal(tree.isRunning(tree.root!), false);
        assert.equal(tree.executing, false);
        assert.equal(tree.status, "success");
    });

    it("aborts every running node once when onAbort interrupts in an interrupt", () => {
        const { ctx, tree } = abortCalls((t) => t.interrupt());
        tree.interrupt();
        assert.deepEqual(ctx.takeLog(), ["abort:A", "abort:B"]);
        assert.equal(tree.status, "interrupted");
        assert.equal(tree.executing, false);
    });

    it("can't tick the tree in onAbort of an interrupt", () => {
        const { ctx, tree } = abortCalls((t) => t.tick());
        const { error } = captureConsole(() => tree.interrupt());
        assert.match(error[0], /ClearSpy#A: .*is executing \(a callback, an abort or a clear\)/);
        assert.deepEqual(ctx.takeLog(), ["abort:A", "abort:B"]);
        assert.equal(tree.tick(), "running");
    });

    it("ignores a clear from a CLEANED listener", () => {
        const ctx = new TestContext();
        const tree = ctx.createTree(
            n("Listen", "listen", { args: { event: TreeEvent.CLEANED }, children: [clearNow("c")] }),
        );
        tree.tick();
        tree.clear();
        assert.deepEqual(ctx.takeLog(), ["clearNow:c"]);
        assert.equal(ctx.listenerCount(TreeEvent.CLEANED), 0);
    });
});
