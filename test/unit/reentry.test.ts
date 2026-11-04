import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Context, Node, NodeDef, Status, Tree } from "../../src/behavior3";
import { n, TestContext } from "./helpers";

/**
 * Re-enters itself through the peer tree of the same path, then logs whether its input and
 * json arg are still the ones of this call, and outputs its input.
 */
class Reenter extends Node {
    declare args: { readonly value?: { tag: string } };
    declare input: [unknown];

    override onTick(tree: Tree<Context, unknown>): Status {
        const ctx = tree.context as ReentryContext;
        const [value] = this.input;
        const arg = this.args.value;
        if (ctx.peer && ctx.peer !== tree) {
            ctx.peer.tick();
        }
        ctx.log.push(`${String(value)}:${this.input[0] === value}:${this.args.value === arg}`);
        this.output.push(value);
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

class ReentryContext extends TestContext {
    peer?: Tree<Context, unknown>;

    constructor() {
        super();
        this.registerNode(Reenter);
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

    it("keeps the json args of the outer call", () => {
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
});
