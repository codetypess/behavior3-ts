import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { AbortMode } from "../../src/behavior3";
import { captureConsole, cond, n, NodeSpec, probe, TestContext } from "./helpers";

/** A condition reading blackboard key `<id>`: success unless set to `failure`. */
const c = (id: string, abort?: AbortMode) => cond(probe(id), abort);

/** The guard monster: flee > attack > patrol. */
const guard = (fleeAbort: AbortMode = "lower", attackAbort: AbortMode = "both"): NodeSpec =>
    n("Selector", "sel", {
        children: [
            probe("flee", { conditions: [c("lowHp", fleeAbort)] }),
            probe("attack", { conditions: [c("hasEnemy", attackAbort)] }),
            probe("patrol"),
        ],
    });

/** Sets the probes to running and the conditions to false. */
const setup = (ctx: TestContext, root: NodeSpec) => {
    const tree = ctx.createTree(root);
    const bb = tree.blackboard;
    for (const k of ["flee", "attack", "patrol"]) bb.set(k, "running");
    bb.set("lowHp", "failure");
    bb.set("hasEnemy", "failure");
    return tree;
};

describe("entry check", () => {
    it("does not enter the node when a condition fails", () => {
        const ctx = new TestContext();
        const tree = ctx.createTree(probe("a", { conditions: [c("c1"), c("c2")] }));
        tree.blackboard.set("c1", "failure");
        assert.equal(tree.tick(), "failure");
        // short circuit: c2 is not evaluated, a is not ticked
        assert.deepEqual(ctx.takeLog(), ["tick:c1"]);
    });

    it("enters the node when all conditions pass", () => {
        const ctx = new TestContext();
        const tree = ctx.createTree(probe("a", { conditions: [c("c1"), c("c2")] }));
        assert.equal(tree.tick(), "success");
        assert.deepEqual(ctx.takeLog(), ["tick:c1", "tick:c2", "tick:a"]);
    });

    it("checks conditions of every mode when entering", () => {
        for (const abort of ["none", "self", "lower", "both", undefined] as const) {
            const ctx = new TestContext();
            const tree = ctx.createTree(n("Selector", "sel", { children: [probe("a", { conditions: [c("c", abort)] })] }));
            tree.blackboard.set("c", "failure");
            assert.equal(tree.tick(), "failure", String(abort));
            assert.deepEqual(ctx.takeLog(), ["tick:c"], String(abort));
        }
    });

    it("works on composite nodes", () => {
        const ctx = new TestContext();
        const tree = ctx.createTree(n("Sequence", "seq", { conditions: [c("c")], children: [probe("a")] }));
        tree.blackboard.set("c", "failure");
        assert.equal(tree.tick(), "failure");
        tree.blackboard.set("c", undefined);
        assert.equal(tree.tick(), "success");
        assert.deepEqual(ctx.takeLog(), ["tick:c", "tick:c", "tick:a"]);
    });

    it("ignores disabled condition trees", () => {
        const ctx = new TestContext();
        const tree = ctx.createTree(probe("a", { conditions: [cond(probe("c", { disabled: true }))] }));
        tree.blackboard.set("c", "failure");
        assert.equal(tree.tick(), "success");
        assert.equal(tree.root!.conditions.length, 0);
    });

    it("throws on an invalid abort mode", () => {
        const ctx = new TestContext();
        assert.throws(
            () => ctx.createTree(probe("a", { conditions: [c("c", "always" as AbortMode)] })),
            /invalid abort mode 'always'/,
        );
    });
});

describe("self", () => {
    it("aborts the running node when a self condition fails", () => {
        const ctx = new TestContext();
        const tree = ctx.createTree(
            n("Group", "g", { conditions: [c("c", "self")], children: [probe("a", { args: { status: "running" } })] }),
        );
        assert.equal(tree.tick(), "running");
        assert.equal(tree.tick(), "running");
        assert.deepEqual(ctx.takeLog(), ["tick:c", "tick:a", "tick:c", "tick:a"]);

        tree.blackboard.set("c", "failure");
        assert.equal(tree.tick(), "failure");
        assert.deepEqual(ctx.takeLog(), ["tick:c", "abort:a", "abort:g"]);
        assert.equal(tree.isRunning(tree.root!), false);
    });

    it("only checks self and both conditions while running", () => {
        const ctx = new TestContext();
        const tree = ctx.createTree(
            probe("a", {
                args: { status: "running" },
                conditions: [c("none", "none"), c("self", "self"), c("lower", "lower"), c("both", "both")],
            }),
        );
        tree.tick();
        assert.deepEqual(ctx.takeLog(), ["tick:none", "tick:self", "tick:lower", "tick:both", "tick:a"]);
        tree.tick();
        assert.deepEqual(ctx.takeLog(), ["tick:self", "tick:both", "tick:a"]);

        // none and lower conditions do not abort the running node
        tree.blackboard.set("none", "failure");
        tree.blackboard.set("lower", "failure");
        assert.equal(tree.tick(), "running");
    });

    it("lets the parent continue with the next child", () => {
        const ctx = new TestContext();
        const tree = setup(ctx, guard());
        tree.blackboard.set("hasEnemy", undefined);
        tree.tick();
        assert.deepEqual(ctx.takeLog(), ["tick:lowHp", "tick:hasEnemy", "tick:attack"]);

        // attack aborts itself, then patrol runs in the same tick
        tree.blackboard.set("hasEnemy", "failure");
        assert.equal(tree.tick(), "running");
        assert.deepEqual(ctx.takeLog(), ["tick:lowHp", "tick:hasEnemy", "abort:attack", "tick:patrol"]);
    });
});

describe("lower (preemption)", () => {
    it("preempts the running lower priority sibling", () => {
        const ctx = new TestContext();
        const tree = setup(ctx, guard());
        tree.tick();
        assert.deepEqual(ctx.takeLog(), ["tick:lowHp", "tick:hasEnemy", "tick:patrol"]);

        // nothing changes: the conditions of the left siblings are checked every tick
        tree.tick();
        assert.deepEqual(ctx.takeLog(), ["tick:lowHp", "tick:hasEnemy", "tick:patrol"]);

        tree.blackboard.set("hasEnemy", undefined);
        tree.tick();
        // the condition is evaluated once: the entry check is skipped after preempting
        assert.deepEqual(ctx.takeLog(), ["tick:lowHp", "tick:hasEnemy", "abort:patrol", "tick:attack"]);
    });

    it("only checks the siblings on the left", () => {
        const ctx = new TestContext();
        const tree = setup(ctx, guard());
        tree.blackboard.set("hasEnemy", undefined);
        tree.tick();
        ctx.takeLog();
        // attack is running: only flee is checked by the parent, attack checks itself (both)
        tree.tick();
        assert.deepEqual(ctx.takeLog(), ["tick:lowHp", "tick:hasEnemy", "tick:attack"]);
    });

    it("the leftmost passed sibling wins", () => {
        const ctx = new TestContext();
        const tree = setup(ctx, guard());
        tree.tick();
        ctx.takeLog();
        tree.blackboard.set("lowHp", undefined);
        tree.blackboard.set("hasEnemy", undefined);
        tree.tick();
        assert.deepEqual(ctx.takeLog(), ["tick:lowHp", "abort:patrol", "tick:flee"]);
    });

    it("a lower-only node is not checked by itself while running", () => {
        const ctx = new TestContext();
        const tree = setup(ctx, guard());
        tree.blackboard.set("lowHp", undefined);
        tree.tick();
        ctx.takeLog();
        // hp recovers: flee keeps running, attack on its right can't preempt it
        tree.blackboard.set("lowHp", "failure");
        tree.blackboard.set("hasEnemy", undefined);
        assert.equal(tree.tick(), "running");
        assert.deepEqual(ctx.takeLog(), ["tick:flee"]);
    });

    it("evaluates all conditions of the sibling to preempt", () => {
        const ctx = new TestContext();
        const tree = ctx.createTree(
            n("Selector", "sel", {
                children: [
                    probe("attack", { conditions: [c("hasEnemy", "lower"), c("hpOk", "none")] }),
                    probe("patrol", { args: { status: "running" } }),
                ],
            }),
        );
        tree.blackboard.set("hasEnemy", "failure");
        tree.tick();
        ctx.takeLog();

        // the enemy appears but hp is not ok: no preemption
        tree.blackboard.set("hasEnemy", undefined);
        tree.blackboard.set("hpOk", "failure");
        tree.tick();
        assert.deepEqual(ctx.takeLog(), ["tick:hasEnemy", "tick:hpOk", "tick:patrol"]);

        tree.blackboard.set("hpOk", undefined);
        tree.tick();
        assert.deepEqual(ctx.takeLog(), ["tick:hasEnemy", "tick:hpOk", "abort:patrol", "tick:attack"]);
    });

    it("continues with the next child when the preempting child fails", () => {
        const ctx = new TestContext();
        const tree = setup(ctx, guard());
        tree.tick();
        ctx.takeLog();
        tree.blackboard.set("hasEnemy", undefined);
        tree.blackboard.set("attack", "failure");
        assert.equal(tree.tick(), "running");
        // attack fails right after preempting, patrol restarts
        assert.deepEqual(ctx.takeLog(), ["tick:lowHp", "tick:hasEnemy", "abort:patrol", "tick:attack", "tick:patrol"]);
    });

    it("checks preemption from the root downward", () => {
        const ctx = new TestContext();
        const tree = ctx.createTree(
            n("Selector", "outer", {
                children: [
                    probe("flee", { conditions: [c("lowHp", "lower")] }),
                    n("Selector", "inner", {
                        children: [
                            probe("attack", { conditions: [c("hasEnemy", "lower")] }),
                            probe("patrol", { args: { status: "running" } }),
                        ],
                    }),
                ],
            }),
        );
        tree.blackboard.set("lowHp", "failure");
        tree.blackboard.set("hasEnemy", "failure");
        tree.tick();
        ctx.takeLog();

        tree.blackboard.set("lowHp", undefined);
        tree.blackboard.set("hasEnemy", undefined);
        tree.tick();
        // the outer selector preempts first, the inner one is not ticked
        assert.deepEqual(ctx.takeLog(), ["tick:lowHp", "abort:patrol", "tick:flee"]);
    });

    it("is scoped to the direct parent", () => {
        const ctx = new TestContext();
        const tree = ctx.createTree(
            n("Selector", "sel", {
                children: [
                    n("Sequence", "seq", {
                        children: [probe("attack", { conditions: [c("hasEnemy", "lower")] })],
                    }),
                    probe("patrol", { args: { status: "running" } }),
                ],
            }),
        );
        tree.blackboard.set("hasEnemy", "failure");
        const { warn } = captureConsole(() => tree.tick());
        assert.equal(warn.length, 0);
        ctx.takeLog();
        tree.blackboard.set("hasEnemy", undefined);
        tree.tick();
        // seq has no conditions, the condition of attack is not checked by sel
        assert.deepEqual(ctx.takeLog(), ["tick:patrol"]);
    });

    it("has no effect under a non-preemptive parent", () => {
        const ctx = new TestContext();
        const { result: tree, warn } = captureConsole(() =>
            ctx.createTree(
                n("Parallel", "par", {
                    // a fails without ending the Parallel
                    args: { successCount: 1 },
                    children: [
                        probe("a", { conditions: [c("c", "lower")] }),
                        probe("b", { args: { status: "running" } }),
                    ],
                }),
            ),
        );
        assert.match(warn[0], /'lower' has no effect: parent 'Parallel' is not preemptive/);
        tree.blackboard.set("c", "failure");
        tree.tick();
        ctx.takeLog();
        tree.blackboard.set("c", undefined);
        tree.tick();
        assert.deepEqual(ctx.takeLog(), ["tick:b"]);
    });

    it("warns on the root node", () => {
        const ctx = new TestContext();
        const { warn } = captureConsole(() => ctx.createTree(probe("a", { conditions: [c("c", "both")] })));
        assert.match(warn[0], /root node has no parent/);
    });

    it("works with custom preemptive composites", () => {
        const ctx = new TestContext();
        const tree = setup(ctx, { ...guard(), name: "PrioritySelector" });
        tree.tick();
        ctx.takeLog();
        tree.blackboard.set("hasEnemy", undefined);
        tree.tick();
        assert.deepEqual(ctx.takeLog(), ["tick:lowHp", "tick:hasEnemy", "abort:patrol", "tick:attack"]);
    });
});

describe("abort modes", () => {
    // [preempts patrol when the enemy appears, stops attacking when the enemy disappears]
    const cases: [AbortMode, boolean, boolean][] = [
        ["both", true, true],
        ["lower", true, false],
        ["self", false, true],
        ["none", false, false],
    ];
    for (const [abort, preempts, stops] of cases) {
        it(`${abort}: preempts=${preempts}, stops=${stops}`, () => {
            const ctx = new TestContext();
            const tree = setup(ctx, guard("lower", abort));
            tree.tick();
            tree.blackboard.set("hasEnemy", undefined);
            tree.tick();
            assert.equal(ctx.takeLog().includes("tick:attack"), preempts);

            const tree2 = setup(ctx, guard("lower", abort));
            tree2.blackboard.set("hasEnemy", undefined);
            tree2.tick();
            tree2.blackboard.set("hasEnemy", "failure");
            ctx.takeLog();
            tree2.tick();
            assert.equal(ctx.takeLog().includes("abort:attack"), stops);
        });
    }
});

describe("condition trees", () => {
    it("supports composite condition trees", () => {
        const ctx = new TestContext();
        // hp < 20 || (stunned && !shield)
        const condition = n("Selector", "or", {
            children: [
                n("Check", "lowHp", { args: { value: "hp < 20" } }),
                n("Sequence", "and", {
                    children: [probe("stunned"), n("Invert", "not", { children: [probe("shield")] })],
                }),
            ],
        });
        const tree = ctx.createTree(probe("a", { conditions: [cond(condition)] }));
        const bb = tree.blackboard;
        bb.set("hp", 100);
        bb.set("shield", "failure");
        assert.equal(tree.tick(), "success");
        bb.set("stunned", "failure");
        assert.equal(tree.tick(), "failure");
        bb.set("hp", 10);
        assert.equal(tree.tick(), "success");
    });

    it("treats running as false and cleans the condition tree", () => {
        const ctx = new TestContext();
        const tree = ctx.createTree(
            n("Selector", "sel", {
                children: [
                    probe("a", {
                        conditions: [cond(n("Group", "cg", { children: [probe("c", { args: { status: "running" } })] }))],
                    }),
                    probe("b"),
                ],
            }),
        );
        const { result, error } = captureConsole(() => tree.tick());
        assert.equal(result, "success");
        assert.match(error[0], /condition tree must not return 'running'/);
        assert.deepEqual(ctx.takeLog(), ["tick:c", "abort:c", "abort:cg", "tick:b"]);
        const cg = tree.root!.children[0].conditions[0].root;
        assert.equal(tree.isRunning(cg), false);
        assert.equal(tree.isRunning(cg.children[0]), false);
    });

    it("interrupts the tree when a condition throws", () => {
        const ctx = new TestContext();
        const tree = ctx.createTree(n("Sequence", "seq", { children: [probe("a", { conditions: [cond(n("Throw", "t"))] })] }));
        const { result, error } = captureConsole(() => tree.tick());
        assert.equal(result, "exception");
        assert.match(error[0], /boom/);
        assert.deepEqual(ctx.takeLog(), []);
    });

    it("reads inputs of nodes in condition trees", () => {
        const ctx = new TestContext();
        const tree = ctx.createTree(
            probe("a", { conditions: [cond(n("NotNull", "nn", { input: ["target"] }))] }),
        );
        assert.equal(tree.tick(), "failure");
        tree.blackboard.set("target", {});
        assert.equal(tree.tick(), "success");
    });
});

describe("Case", () => {
    it("warns about conditions on Case", () => {
        const ctx = new TestContext();
        const { result: tree, warn } = captureConsole(() =>
            ctx.createTree(
                n("Switch", "sw", {
                    children: [n("Case", "case", { conditions: [c("c")], children: [probe("x"), probe("y")] })],
                }),
            ),
        );
        assert.match(warn[0], /conditions are ignored: Case is never ticked/);
        tree.blackboard.set("c", "failure");
        assert.equal(tree.tick(), "success");
        assert.deepEqual(ctx.takeLog(), ["tick:x", "tick:y"]);
    });
});

describe("condition scope", () => {
    const read = (id: string, key: string, status?: string) =>
        n("Read", id, { args: { key, status } });
    const letv = (id: string, key: string, value: unknown) =>
        n("Let", id, { args: { value }, output: [key] });
    const check = (id: string, value: string) => n("Check", id, { args: { value } });
    const seq = (id: string, ...children: NodeSpec[]) => n("Sequence", id, { children });
    const scope = (id: string, child: NodeSpec, output: string[] = []) =>
        n("Scope", id, { output, children: [child] });

    it("drops the writes of the condition tree", () => {
        const ctx = new TestContext();
        const guarded = ctx.createTree(
            seq(
                "main",
                probe("a", {
                    conditions: [
                        cond(
                            seq(
                                "c",
                                letv("l", "x", 1),
                                n("Write", "w", { args: { key: "y", value: 2 } }),
                                check("k", "x == 1"),
                            ),
                        ),
                    ],
                }),
                read("r", "x"),
            ),
        );
        assert.equal(guarded.tick(), "success");
        assert.deepEqual(ctx.takeLog(), ["tick:a", "read:r=undefined"]);
        assert.deepEqual(Object.keys(guarded.blackboard.values), []);
    });

    it("reads the variables of the tree", () => {
        const ctx = new TestContext();
        const tree = ctx.createTree(probe("a", { conditions: [cond(check("k", "hp > 0"))] }));
        tree.blackboard.set("hp", 1);
        assert.equal(tree.tick(), "success");
        tree.blackboard.set("hp", 0);
        assert.equal(tree.tick(), "failure");
    });

    it("starts every evaluation with a fresh scope", () => {
        const ctx = new TestContext();
        const tree = ctx.createTree(
            probe("a", { conditions: [cond(seq("c", read("r", "x"), letv("l", "x", 1)), "self")] }),
        );
        tree.blackboard.set("a", "running");
        tree.tick();
        tree.tick();
        assert.deepEqual(ctx.takeLog(), [
            "read:r=undefined",
            "tick:a",
            "read:r=undefined",
            "tick:a",
        ]);
    });

    it("exports the output of a Scope root when the condition is true", () => {
        const ctx = new TestContext();
        const tree = ctx.createTree(
            seq(
                "main",
                read("a", "target"),
                n("Sequence", "guarded", {
                    conditions: [
                        cond(
                            scope(
                                "s",
                                seq(
                                    "c",
                                    letv("l", "target", 5),
                                    letv("t", "tmp", 1),
                                    check("k", "target == 5"),
                                ),
                                ["target"],
                            ),
                        ),
                    ],
                    children: [read("r", "target")],
                }),
            ),
        );
        assert.equal(tree.tick(), "success");
        assert.deepEqual(ctx.takeLog(), ["read:a=undefined", "read:r=5"]);
        assert.equal(tree.blackboard.get("target"), 5);
        assert.equal(tree.blackboard.get("tmp"), undefined);
    });

    it("doesn't export the output of a Scope root when the condition is false", () => {
        const ctx = new TestContext();
        const tree = ctx.createTree(
            probe("a", {
                conditions: [
                    cond(
                        scope("s", seq("c", letv("l", "target", 5), check("k", "target == 6")), [
                            "target",
                        ]),
                    ),
                ],
            }),
        );
        tree.blackboard.set("target", 1);
        assert.equal(tree.tick(), "failure");
        assert.equal(tree.blackboard.get("target"), 1);
    });

    it("doesn't export the output of a Scope root on error", () => {
        const ctx = new TestContext();
        const tree = ctx.createTree(
            probe("a", {
                conditions: [
                    cond(
                        scope("s", seq("c", letv("l", "target", 5), check("k", "missing > 0")), [
                            "target",
                        ]),
                    ),
                ],
            }),
        );
        assert.equal(tree.tick(), "failure");
        assert.equal(tree.blackboard.get("target"), undefined);
    });

    it("drops the output of a Scope below the root", () => {
        const ctx = new TestContext();
        const tree = ctx.createTree(
            probe("a", {
                conditions: [
                    cond(seq("c", scope("s", letv("l", "t", 1), ["t"]), check("k", "t == 1"))),
                ],
            }),
        );
        assert.equal(tree.tick(), "success");
        assert.equal(tree.blackboard.get("t"), undefined);
    });

    it("exports into the scope where the condition is evaluated", () => {
        const ctx = new TestContext();
        const tree = ctx.createTree(
            scope(
                "outer",
                seq(
                    "main",
                    n("Sequence", "guarded", {
                        conditions: [cond(scope("s", letv("l", "t", 1), ["t"]))],
                        children: [read("r", "t")],
                    }),
                    read("r2", "t"),
                ),
            ),
        );
        tree.tick();
        assert.deepEqual(ctx.takeLog(), ["read:r=1", "read:r2=1"]);
        assert.equal(tree.blackboard.get("t"), undefined);
    });

    it("exports the output of a Scope root outside a Scope node with the condition", () => {
        const ctx = new TestContext();
        const tree = ctx.createTree(
            n("Scope", "guarded", {
                conditions: [cond(scope("s", letv("l", "t", 1), ["t"]))],
                children: [read("r", "t")],
            }),
        );
        tree.tick();
        // the condition of a Scope node runs outside it, the export lands in the outer scope
        assert.deepEqual(ctx.takeLog(), ["read:r=1"]);
        assert.equal(tree.blackboard.get("t"), 1);
    });

    it("refreshes the export of a self condition every tick", () => {
        const ctx = new TestContext();
        const tree = ctx.createTree(
            probe("a", {
                conditions: [
                    cond(
                        scope(
                            "s",
                            n("Calculate", "calc", { args: { value: "hp * 2" }, output: ["d"] }),
                            ["d"],
                        ),
                        "self",
                    ),
                ],
            }),
        );
        tree.blackboard.set("a", "running");
        tree.blackboard.set("hp", 1);
        tree.tick();
        assert.equal(tree.blackboard.get("d"), 2);
        tree.blackboard.set("hp", 2);
        tree.tick();
        assert.equal(tree.blackboard.get("d"), 4);
    });

    it("aborts a running condition tree in its scope", () => {
        const ctx = new TestContext();
        const tree = ctx.createTree(
            probe("a", {
                conditions: [cond(seq("c", letv("l", "x", 1), read("r", "x", "running")))],
            }),
        );
        const { error } = captureConsole(() => assert.equal(tree.tick(), "failure"));
        assert.match(error[0], /condition tree must not return 'running'/);
        assert.deepEqual(ctx.takeLog(), ["read:r=1", "abort:r=1"]);
        assert.equal(tree.blackboard.get("x"), undefined);
    });

    it("aborts a running condition tree with a Scope root in the scope", () => {
        const ctx = new TestContext();
        const tree = ctx.createTree(
            probe("a", {
                conditions: [
                    cond(scope("s", seq("c", letv("l", "x", 1), read("r", "x", "running")), ["x"])),
                ],
            }),
        );
        const { error } = captureConsole(() => assert.equal(tree.tick(), "failure"));
        assert.match(error[0], /condition tree must not return 'running'/);
        assert.deepEqual(ctx.takeLog(), ["read:r=1", "abort:r=1"]);
        assert.equal(tree.blackboard.get("x"), undefined);
    });

    it("checks preemption in the scope of the preemptive parent", () => {
        const ctx = new TestContext();
        const tree = ctx.createTree(
            n("PrioritySelector", "sel", {
                children: [
                    probe("flee", { conditions: [cond(check("k", "x == 1"), "lower")] }),
                    scope("s", seq("in", letv("l", "x", 1), probe("p"))),
                ],
            }),
        );
        tree.blackboard.set("p", "running");
        tree.tick();
        tree.tick();
        // x of the running scope is not visible to the preemption check
        assert.deepEqual(ctx.takeLog(), ["tick:p", "tick:p"]);
    });

    it("evaluates a self condition inside a Scope in the scope", () => {
        const ctx = new TestContext();
        const tree = ctx.createTree(
            scope(
                "s",
                seq(
                    "in",
                    letv("l", "x", 1),
                    probe("p", { conditions: [cond(check("k", "x == 1"), "self")] }),
                ),
            ),
        );
        tree.blackboard.set("p", "running");
        assert.equal(tree.tick(), "running");
        assert.equal(tree.tick(), "running");
        assert.deepEqual(ctx.takeLog(), ["tick:p", "tick:p"]);
    });

    it("keeps the state of Once in a condition tree", () => {
        const ctx = new TestContext();
        const tree = ctx.createTree(
            probe("a", { conditions: [cond(n("Once", "once", { children: [probe("c")] }))] }),
        );
        assert.equal(tree.tick(), "success");
        assert.equal(tree.tick(), "failure");
        assert.deepEqual(ctx.takeLog(), ["tick:c", "tick:a"]);
    });

    it("doesn't allow Listen in a condition tree", () => {
        const ctx = new TestContext();
        const listen = n("Listen", "listen", { args: { event: "hit" }, children: [probe("r")] });
        assert.throws(
            () =>
                ctx.createTree(
                    probe("a", {
                        conditions: [cond(seq("c", n("Once", "once", { children: [listen] })))],
                    }),
                ),
            /Listen#listen: 'Listen' is deferred, not allowed in a condition tree/,
        );
    });

    it("doesn't allow Delay in a condition tree", () => {
        const ctx = new TestContext();
        const delay = n("Delay", "delay", { args: { delay: 1 }, children: [probe("r")] });
        assert.throws(
            () => ctx.createTree(probe("a", { conditions: [cond(delay)] })),
            /Delay#delay: 'Delay' is deferred, not allowed in a condition tree/,
        );
    });

    it("checks the condition trees nested in a condition tree", () => {
        const ctx = new TestContext();
        const listen = n("Listen", "listen", { args: { event: "hit" }, children: [probe("r")] });
        assert.throws(
            () =>
                ctx.createTree(
                    probe("a", { conditions: [cond(probe("b", { conditions: [cond(listen)] }))] }),
                ),
            /is deferred, not allowed in a condition tree/,
        );
    });

    it("ignores a disabled node in a condition tree", () => {
        const ctx = new TestContext();
        const listen = n("Listen", "listen", {
            args: { event: "hit" },
            disabled: true,
            children: [probe("r")],
        });
        const tree = ctx.createTree(
            probe("a", { conditions: [cond(seq("c", probe("b"), listen))] }),
        );
        assert.equal(tree.tick(), "success");
    });

    it("allows Listen and Delay outside the condition trees", () => {
        const ctx = new TestContext();
        const tree = ctx.createTree(
            seq(
                "main",
                n("Listen", "listen", { args: { event: "hit" }, children: [probe("r")] }),
                n("Delay", "delay", { args: { delay: 1 }, children: [probe("d")] }),
            ),
        );
        assert.equal(tree.tick(), "success");
    });
});
