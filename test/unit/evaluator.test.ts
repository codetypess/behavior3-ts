import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ExpressionEvaluator } from "../../src/behavior3";
import { captureConsole, n, TestContext } from "./helpers";

const env = {
    a: 3,
    b: 4,
    s: "hi",
    t: true,
    f: false,
    i: 1,
    k: "x",
    arr: [10, 20, 30],
    names: ["x", "y"],
    obj: { x: 5, name: "bob", list: [1, "two"], inner: { y: 7 } },
};

const evaluate = (expr: string, args: object = env) => new ExpressionEvaluator(expr).evaluate(args as never);

const dryRun = (expr: string) => captureConsole(() => new ExpressionEvaluator(expr).dryRun()).result;

describe("expression evaluator", () => {
    it("arithmetic and precedence", () => {
        assert.equal(evaluate("a + b * 2"), 11);
        assert.equal(evaluate("(a + b) * 2"), 14);
        assert.equal(evaluate("a - b - 1"), -2);
        assert.equal(evaluate("a / 2"), 1.5);
        assert.equal(evaluate("a % 2"), 1);
        assert.equal(evaluate("1.5 * 2"), 3);
    });

    it("unary operators", () => {
        assert.equal(evaluate("-a + +b"), 1);
        assert.equal(evaluate("a - -b"), 7);
        assert.equal(evaluate("a - -b * 2"), 11);
        assert.equal(evaluate("-a * -b"), 12);
        assert.equal(evaluate("-(a + b)"), -7);
        assert.equal(evaluate("!t"), false);
        assert.equal(evaluate("!!t"), true);
        assert.equal(evaluate("~a"), -4);
    });

    it("comparisons", () => {
        assert.equal(evaluate("a > b"), false);
        assert.equal(evaluate("a >= 3"), true);
        assert.equal(evaluate("a < b"), true);
        assert.equal(evaluate("a <= 2"), false);
        assert.equal(evaluate("a == 3"), true);
        assert.equal(evaluate("a != 3"), false);
    });

    it("strings", () => {
        assert.equal(evaluate("s == 'hi'"), true);
        assert.equal(evaluate('s == "hi"'), true);
        assert.equal(evaluate("s != 'ho'"), true);
        assert.equal(evaluate("'hi'"), "hi");
    });

    it("logical operators with boolean variables", () => {
        assert.equal(evaluate("t && f"), false);
        assert.equal(evaluate("t || f"), true);
        assert.equal(evaluate("!t || t"), true);
        assert.equal(evaluate("a > 1 && b < 5"), true);
    });

    it("bitwise operators", () => {
        assert.equal(evaluate("a & 1"), 1);
        assert.equal(evaluate("a | 4"), 7);
        assert.equal(evaluate("a ^ 1"), 2);
        assert.equal(evaluate("1 << 3"), 8);
        assert.equal(evaluate("-8 >> 1"), -4);
        assert.equal(evaluate("-8 >>> 28"), 15);
    });

    it("ternary operator", () => {
        assert.equal(evaluate("a > 1 ? 10 : 20"), 10);
        assert.equal(evaluate("a > 5 ? 10 : 20"), 20);
        assert.equal(evaluate("f ? 1 : 2"), 2);
        assert.equal(evaluate("a > 1 ? 'yes' : 'no'"), "yes");
        assert.equal(evaluate("a > 1 ? b + 1 : b - 1"), 5);
        // nested in the true branch, with or without parentheses
        assert.equal(evaluate("a > 1 ? (b > 3 ? 1 : 2) : 3"), 1);
        assert.equal(evaluate("a > 1 ? b > 5 ? 1 : 2 : 3"), 2);
        // chained in the false branch
        assert.equal(evaluate("a < 1 ? 1 : b < 1 ? 2 : 3"), 3);
        assert.equal(evaluate("a < 1 ? 1 : b > 1 ? 2 : 3"), 2);
    });

    it("property and index access", () => {
        assert.equal(evaluate("obj.x"), 5);
        assert.equal(evaluate("obj.inner.y * 2"), 14);
        assert.equal(evaluate("obj.name == 'bob'"), true);
        assert.equal(evaluate("obj.list[1] == 'two'"), true);
        assert.equal(evaluate("arr[1]"), 20);
        assert.equal(evaluate("arr[i] + 1"), 21);
        assert.equal(evaluate("arr[i + 1]"), 30);
        assert.equal(evaluate("arr[0] + arr[i + 1]"), 40);
        assert.equal(evaluate("names[0] == 'x'"), true);
        assert.equal(evaluate("obj[k]"), 5);
        assert.equal(evaluate("obj['x']"), 5);
    });

    it("returns the value of a single variable", () => {
        assert.equal(evaluate("t"), true);
        assert.equal(evaluate("f"), false);
        assert.equal(evaluate("a"), 3);
        assert.equal(evaluate("s"), "hi");
        assert.equal(evaluate("obj"), env.obj);
        assert.equal(evaluate("obj.inner"), env.obj.inner);
    });

    it("throws on bad values", () => {
        assert.throws(() => evaluate("missing"), /'missing' is not found/);
        assert.throws(() => evaluate("missing > 1"), /'missing' is not found/);
        assert.throws(() => evaluate("s + 1"), /'s' is not a number/);
        assert.throws(() => evaluate("obj.name + 1"), /'bob' is not a number/);
        assert.throws(() => evaluate("a.x"), /'a' is not a object/);
        assert.throws(() => evaluate("obj.x.y"), /'5' is not a object/);
    });

    it("throws on syntax errors when parsing", () => {
        assert.throws(() => new ExpressionEvaluator("(a + b"), /unmatched parentheses: '\('/);
        assert.throws(() => new ExpressionEvaluator("a)"), /unmatched parentheses: '\)'/);
        assert.throws(() => new ExpressionEvaluator("arr[1"), /unmatched parentheses: '\['/);
        assert.throws(() => new ExpressionEvaluator("(a]"), /unmatched parentheses: '\]'/);
        assert.throws(() => new ExpressionEvaluator("a : b"), /unexpected ':'/);
        assert.throws(() => new ExpressionEvaluator("a ? b"), /missing ':'/);
        assert.throws(() => new ExpressionEvaluator("'abc"), /invalid expression/);
        assert.throws(() => new ExpressionEvaluator("a $ b"), /invalid expression/);
    });

    it("dryRun checks the operands", () => {
        assert.equal(dryRun("a > 1 ? obj.x : arr[i + 1]"), true);
        assert.equal(dryRun("a +"), false);
        assert.equal(dryRun("1 +* 2"), false);
        assert.equal(dryRun("a b"), false);
        assert.equal(dryRun("obj.1"), false);
    });
});

describe("expressions in nodes", () => {
    it("compileCode caches the evaluator and checks the syntax", () => {
        const ctx = new TestContext();
        assert.equal(ctx.compileCode("a + 1"), ctx.compileCode("a + 1"));
        assert.throws(() => ctx.compileCode("a +"), /invalid expression: a \+/);
        assert.throws(() => ctx.createTree(n("Check", "c", { args: { value: "a +" } })));
    });

    it("registerCode replaces the evaluator", () => {
        const ctx = new TestContext();
        ctx.registerCode("magic", () => 42);
        const tree = ctx.createTree(n("Calculate", "c", { args: { value: "magic" }, output: ["v"] }));
        tree.tick();
        assert.equal(tree.blackboard.get("v"), 42);
        assert.equal(tree.blackboard.eval("magic"), 42);
    });

    it("Check with a single boolean variable", () => {
        const ctx = new TestContext();
        const tree = ctx.createTree(n("Check", "c", { args: { value: "dead" } }));
        tree.blackboard.set("dead", false);
        assert.equal(tree.tick(), "failure");
        tree.blackboard.set("dead", true);
        assert.equal(tree.tick(), "success");
    });

    it("a bad value in an expression is an error", () => {
        const ctx = new TestContext();
        const tree = ctx.createTree(n("Check", "c", { args: { value: "hp > 1" } }));
        const { result, warn } = captureConsole(() => tree.tick());
        assert.equal(result, "error");
        assert.match(warn[0], /Check#c: .*'hp' is not found/);
    });
});
