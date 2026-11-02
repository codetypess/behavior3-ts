import assert from "node:assert/strict";
import { describe, it } from "node:test";
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
