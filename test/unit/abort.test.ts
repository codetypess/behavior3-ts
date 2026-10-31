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

    it("an error stops the tick and returns error", () => {
        const ctx = new TestContext();
        const tree = ctx.createTree(n("Sequence", "seq", { children: [probe("a"), n("Throw", "t"), probe("b")] }));
        const { result, error } = captureConsole(() => tree.tick());
        assert.equal(result, "error");
        assert.match(error[0], /boom/);
        assert.deepEqual(ctx.takeLog(), ["tick:a"]);
        assert.equal(tree.isRunning(tree.root!), false);
    });

    it("dispatches ERROR with the error and the node, then INTERRUPTED", () => {
        const ctx = new TestContext();
        const tree = ctx.createTree(
            n("Selector", "sel", { children: [n("Concat", "x", { input: ["a", "b"] }), probe("b")] }),
        );
        tree.blackboard.set("a", 1);
        const events: string[] = [];
        ctx.on(TreeEvent.ERROR, tree, (error: Error, node: Node) => events.push(`error:${node.id}:${error.message}`), "test");
        ctx.on(TreeEvent.INTERRUPTED, tree, () => events.push("interrupted"), "test");
        const { result, error } = captureConsole(() => tree.tick());
        assert.equal(result, "error");
        assert.match(error[0], /Concat#x: invalid array: 1 or undefined/);
        assert.equal(events.length, 2);
        assert.match(events[0], /^error:x:.*invalid array/);
        assert.equal(events[1], "interrupted");
        // the Selector doesn't take the error as a failure and fall back to the next child
        assert.deepEqual(ctx.takeLog(), []);
    });

    it("prints the location of the node once", () => {
        const ctx = new TestContext();
        const thrown = ctx.createTree(n("Concat", "x", { input: ["a", "b"] }));
        const e1 = captureConsole(() => thrown.tick()).error[0];
        assert.match(e1, /^Error: test-tree-\d+->Concat#x: invalid array/);
        assert.equal(e1.match(/Concat#x/g)!.length, 1);

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
        ctx.on(TreeEvent.ERROR, tree, (error: Error) => (received = error), "test");
        const { result } = captureConsole(() => tree.tick());
        assert.equal(result, "error");
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

describe("errors", () => {
    it("the error status is only for the tick with the error", () => {
        const ctx = new TestContext();
        const tree = ctx.createTree(n("Sequence", "seq", { children: [probe("a"), probe("b")] }));
        tree.blackboard.set("a", "running");
        tree.tick();
        const probeNode = tree.root!.children[0];
        const onTick = probeNode.onTick;
        // the error wins over an interrupt in the same tick
        probeNode.onTick = (t) => {
            t.interrupt();
            throw new Error("boom");
        };
        assert.equal(captureConsole(() => tree.tick()).result, "error");
        assert.equal(tree.status, "error");
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
        ctx.on(TreeEvent.ERROR, tree, (_: Error, node: Node) => events.push(`error:${node.id}`), "test");
        ctx.on(TreeEvent.INTERRUPTED, tree, () => events.push("interrupted"), "test");
        tree.tick();
        ctx.takeLog();

        const { error } = captureConsole(() => ctx.dispatch("e"));
        assert.match(error[0], /boom/);
        assert.deepEqual(events, ["error:t"]);
        // no fallback, and the main branch is still running
        assert.deepEqual(ctx.takeLog(), []);
        assert.equal(tree.status, "running");
        assert.equal(tree.isRunning(tree.root!.children[1]), true);

        assert.equal(tree.tick(), "running");
        assert.deepEqual(ctx.takeLog(), ["tick:main"]);
        // the listener still works
        captureConsole(() => ctx.dispatch("e"));
        assert.deepEqual(events, ["error:t", "error:t"]);
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
        return { name: "Switcher", type: "Composite", desc: "leaks the running child", children: -1 };
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
