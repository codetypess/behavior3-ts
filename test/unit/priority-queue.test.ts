import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PriorityQueue } from "../../src/behavior3";

/** A deterministic random number in [0, 1). */
const random = (() => {
    let seed = 7;
    return () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
})();

const drain = <T>(queue: PriorityQueue<T>) => {
    const items: T[] = [];
    for (let item = queue.pop(); item !== undefined; item = queue.pop()) {
        items.push(item);
    }
    return items;
};

describe("PriorityQueue", () => {
    it("pops the items in the order of compare", () => {
        const queue = new PriorityQueue<number>((a, b) => a - b);
        for (const v of [5, 1, 4, 1, 3, 9, 2, 6]) {
            queue.push(v);
        }
        assert.equal(queue.size, 8);
        assert.equal(queue.peek(), 1);
        assert.deepEqual(drain(queue), [1, 1, 2, 3, 4, 5, 6, 9]);
        assert.equal(queue.size, 0);
    });

    it("returns undefined when empty", () => {
        const queue = new PriorityQueue<number>((a, b) => a - b);
        assert.equal(queue.peek(), undefined);
        assert.equal(queue.pop(), undefined);
        queue.push(1);
        assert.equal(queue.pop(), 1);
        assert.equal(queue.pop(), undefined);
    });

    it("is a max heap with a reversed compare", () => {
        const queue = new PriorityQueue<number>((a, b) => b - a);
        [3, 7, 1, 9].forEach((v) => queue.push(v));
        assert.deepEqual(drain(queue), [9, 7, 3, 1]);
    });

    it("keeps the order of equal keys with a sequence number", () => {
        type Item = { key: number; seq: number };
        const queue = new PriorityQueue<Item>((a, b) => a.key - b.key || a.seq - b.seq);
        let seq = 0;
        for (let i = 0; i < 50; i++) {
            queue.push({ key: i % 3, seq: seq++ });
        }
        const items = drain(queue);
        for (let i = 1; i < items.length; i++) {
            const [a, b] = [items[i - 1], items[i]];
            assert.ok(a.key < b.key || (a.key === b.key && a.seq < b.seq));
        }
    });

    it("retains the matching items and stays a heap", () => {
        const queue = new PriorityQueue<number>((a, b) => a - b);
        for (let i = 0; i < 100; i++) {
            queue.push(2 + Math.floor(random() * 1000));
        }
        queue.retain((v) => v % 2 === 0);
        queue.push(1);
        const items = drain(queue);
        assert.equal(items[0], 1);
        assert.ok(items.slice(1).every((v) => v % 2 === 0));
        assert.deepEqual(
            items,
            [...items].sort((a, b) => a - b),
        );
    });

    it("clears the items", () => {
        const queue = new PriorityQueue<number>((a, b) => a - b);
        [1, 2, 3].forEach((v) => queue.push(v));
        queue.clear();
        assert.equal(queue.size, 0);
        assert.equal(queue.pop(), undefined);
    });

    it("matches a sorted array on random pushes and pops", () => {
        const queue = new PriorityQueue<number>((a, b) => a - b);
        const ref: number[] = [];
        for (let step = 0; step < 10000; step++) {
            if (random() < 0.6) {
                const v = Math.floor(random() * 100);
                queue.push(v);
                ref.push(v);
                ref.sort((a, b) => a - b);
            } else {
                assert.equal(queue.pop(), ref.shift());
            }
            assert.equal(queue.size, ref.length);
            assert.equal(queue.peek(), ref[0]);
        }
    });
});
