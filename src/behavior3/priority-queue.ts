/**
 * A priority queue on a binary heap: `pop` returns the first item by `compare`, which has the
 * meaning of the comparator of `Array.prototype.sort`: a negative result puts `a` before `b`.
 *
 * `push` and `pop` are O(log n), `peek` and `size` are O(1). The items comparing equal pop in no
 * defined order: add a sequence number to the key for a stable order (first in, first out).
 *
 * To remove items, mark them and skip them when popped, then `retain` the others once the marked
 * items are many, like the timers of `Context`.
 */
export class PriorityQueue<T> {
    private readonly _items: T[] = [];
    private readonly _compare: (a: T, b: T) => number;

    constructor(compare: (a: T, b: T) => number) {
        this._compare = compare;
    }

    /** The number of items. */
    get size() {
        return this._items.length;
    }

    /** The first item, without removing it. */
    peek(): T | undefined {
        return this._items[0];
    }

    push(item: T) {
        const items = this._items;
        const compare = this._compare;
        let i = items.push(item) - 1;
        while (i > 0) {
            const parent = (i - 1) >> 1;
            if (compare(item, items[parent]) >= 0) {
                break;
            }
            items[i] = items[parent];
            i = parent;
        }
        items[i] = item;
    }

    /** Removes and returns the first item. */
    pop(): T | undefined {
        const items = this._items;
        const top = items[0];
        const last = items.pop();
        if (items.length > 0) {
            this._siftDown(0, last as T);
        }
        return top;
    }

    /** Keeps the items matching `keep` and removes the others, O(n). */
    retain(keep: (item: T) => boolean) {
        const items = this._items;
        let n = 0;
        for (let i = 0; i < items.length; i++) {
            const item = items[i];
            if (keep(item)) {
                items[n++] = item;
            }
        }
        items.length = n;
        for (let i = (n >> 1) - 1; i >= 0; i--) {
            this._siftDown(i, items[i]);
        }
    }

    clear() {
        this._items.length = 0;
    }

    private _siftDown(i: number, item: T) {
        const items = this._items;
        const compare = this._compare;
        const n = items.length;
        for (;;) {
            let child = 2 * i + 1;
            if (child >= n) {
                break;
            }
            if (child + 1 < n && compare(items[child + 1], items[child]) < 0) {
                child++;
            }
            if (compare(items[child], item) >= 0) {
                break;
            }
            items[i] = items[child];
            i = child;
        }
        items[i] = item;
    }
}
