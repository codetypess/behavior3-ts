import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Context, Node, NodeDef, Status, Tree } from "../../src/behavior3";
import { captureConsole, n, TestContext } from "./helpers";

/**
 * Re-enters itself through the peer tree of the same path, then logs whether its input and
 * json arg are still the ones of this call, and outputs its input.
 */
class Reenter extends Node {
    declare args: { readonly value?: { tag: string } };

    override onTick(
        tree: Tree<Context, unknown>,
        input: readonly [unknown],
        output: unknown[],
    ): Status {
        const ctx = tree.context as ReentryContext;
        const [value] = input;
        const arg = this.args.value;
        if (ctx.peer && ctx.peer !== tree) {
            ctx.peer.tick();
        }
        ctx.log.push(`${String(value)}:${input[0] === value}:${this.args.value === arg}`);
        output.push(value);
        return "success";
    }

    static override get descriptor(): NodeDef {
        return {
            name: "Reenter",
            type: "Action",
            group: ["Test"],
            desc: "re-enter through the peer tree",
            args: [{ name: "value", type: "json?", desc: "json" }],
        };
    }
}

/**
 * Doubles `v` and dispatches `ping` heard by the `Listen` above it in the same tree, until it is
 * called 3 times, then logs whether its input is still the one of this call.
 */
class Ping extends Node {
    override onTick(
        tree: Tree<Context, unknown>,
        input: readonly [number],
        output: [number?],
    ): Status {
        const ctx = tree.context as ReentryContext;
        const [value] = input;
        if (++ctx.pings < 3) {
            tree.blackboard.set("v", value * 2);
            ctx.dispatch("ping");
        }
        ctx.log.push(`${value}:${input[0] === value}:${output.length === 0}`);
        output.push(value);
        return "success";
    }

    static override get descriptor(): NodeDef {
        return { name: "Ping", type: "Action", group: ["Test"], desc: "re-enter through Listen" };
    }
}

class ReentryContext extends TestContext {
    pings = 0;

    peer?: Tree<Context, unknown>;

    constructor() {
        super();
        this.registerNode(Reenter);
        this.registerNode(Ping);
    }
}

const filterTree = (call: ReturnType<typeof n>) =>
    n("Filter", "filter", {
        input: ["items"],
        output: ["item", "result"],
        children: [
            n("Selector", "predicate", {
                children: [n("Check", "base", { args: { value: "item == 0" } }), call],
            }),
        ],
    });

describe("re-entered node", () => {
    it("keeps the output of the outer call through a recursive RunTree", () => {
        const ctx = new TestContext();
        ctx.defineTree(
            "recursive-filter",
            filterTree(
                n("Sequence", "recurse", {
                    children: [
                        n("Let", "inner-items", { args: { value: [0] }, output: ["items"] }),
                        n("RunTree", "inner-call", {
                            args: { path: "recursive-filter" },
                            input: ["", "items"],
                        }),
                    ],
                }),
            ),
        );
        const tree = ctx.createTree(
            n("RunTree", "outer-call", {
                args: { path: "recursive-filter" },
                input: ["", "items"],
                output: ["result"],
            }),
        );
        tree.blackboard.set("items", [1]);
        assert.equal(tree.tick(), "success");
        assert.deepEqual(tree.blackboard.get("result"), [1]);
    });

    it("keeps the output of the outer call when another tree of the path is ticked", () => {
        const ctx = new ReentryContext();
        ctx.defineTree(
            "shared",
            filterTree(n("Reenter", "call", { input: ["item"], output: ["seen"] })),
        );
        const a = new Tree(ctx, {}, "shared");
        const b = new Tree(ctx, {}, "shared");
        ctx.peer = b;
        a.blackboard.set("items", [1]);
        b.blackboard.set("items", [0, 2]);
        assert.equal(a.tick(), "success");
        // the call in b re-enters the Filter and Reenter of a
        assert.deepEqual(ctx.takeLog(), ["2:true:true", "1:true:true"]);
        assert.deepEqual(a.blackboard.get("result"), [1]);
        assert.equal(a.blackboard.get("seen"), 1);
        assert.deepEqual(b.blackboard.get("result"), [0, 2]);
        assert.equal(b.blackboard.get("seen"), 2);
    });

    it("keeps the args of the outer call", () => {
        const ctx = new ReentryContext();
        ctx.defineTree(
            "json",
            n("Reenter", "call", { args: { value: { tag: "x" } }, input: ["v"], output: ["out"] }),
        );
        const a = new Tree(ctx, {}, "json");
        const b = new Tree(ctx, {}, "json");
        ctx.peer = b;
        a.blackboard.set("v", "a");
        b.blackboard.set("v", "b");
        a.tick();
        assert.deepEqual(ctx.takeLog(), ["b:true:true", "a:true:true"]);
        assert.equal(a.blackboard.get("out"), "a");
        assert.equal(b.blackboard.get("out"), "b");
    });

    it("ticks normally again after a re-entry", () => {
        const ctx = new ReentryContext();
        ctx.defineTree("again", n("Reenter", "call", { input: ["v"], output: ["out"] }));
        const a = new Tree(ctx, {}, "again");
        ctx.peer = new Tree(ctx, {}, "again");
        a.blackboard.set("v", 1);
        a.tick();
        ctx.peer = undefined;
        a.blackboard.set("v", 2);
        a.tick();
        assert.deepEqual(ctx.takeLog(), ["undefined:true:true", "1:true:true", "2:true:true"]);
        assert.equal(a.blackboard.get("out"), 2);
    });

    it("keeps the input and output of the outer call when a callback re-enters it", () => {
        const ctx = new ReentryContext();
        ctx.defineTree(
            "ping",
            n("Listen", "l", {
                args: { event: "ping" },
                children: [n("Ping", "p", { input: ["v"], output: ["out"] })],
            }),
        );
        const tree = new Tree(ctx, {}, "ping");
        tree.tick();
        tree.blackboard.set("v", 1);
        ctx.dispatch("ping");
        // the same node of the same tree, three calls nested by the callbacks
        assert.deepEqual(ctx.takeLog(), ["4:true:true", "2:true:true", "1:true:true"]);
        assert.equal(tree.blackboard.get("out"), 1);
    });

    it("restores the frame stack when an exception escapes a node", () => {
        const ctx = new ReentryContext();
        const boom = (tree: Tree<Context, unknown>) =>
            Object.defineProperty(tree.blackboard.values, "boom", {
                get() {
                    throw new Error("boom");
                },
            });
        // reading the input of the root throws out of `tree.tick`
        const root = ctx.createTree(n("Reenter", "call", { input: ["boom"] }));
        boom(root);
        assert.throws(() => root.tick(), /boom/);
        assert.equal(Node.__frameDepth, 0);
        // caught by the parent, which leaves the stack above for its own call to set back
        const nested = ctx.createTree(
            n("Sequence", "seq", { children: [n("Reenter", "call", { input: ["boom"] })] }),
        );
        boom(nested);
        captureConsole(() => nested.tick());
        assert.equal(Node.__frameDepth, 0);
    });
});
