import type { Context, ObjectType } from "./context";
import type { Node } from "./node";
import type { Tree } from "./tree";

const PREFIX_PRIVATE = "__PRIVATE_VAR";
const PREFIX_TEMP = "__TEMP_VAR";

const hasOwn = Object.prototype.hasOwnProperty;

/**
 * The variables of a tree.
 *
 * The root blackboard belongs to the tree. A scope (`Scope` node, condition tree) forks an
 * overlay from the current blackboard: it reads the outer variables through the prototype
 * chain, writes stay in the overlay. Private and temp vars are the internal state of nodes,
 * they always live in the root blackboard.
 *
 * The values of an overlay are created on the first write, an overlay which is only read
 * (most condition trees) reads the outer values directly.
 */
export class Blackboard {
    /** `undefined`: an overlay not written yet. */
    protected _values: ObjectType | undefined;
    protected _tree: Tree<Context, unknown>;
    protected _parent: Blackboard | undefined;
    protected _root: Blackboard;

    constructor(tree: Tree<Context, unknown>, parent?: Blackboard) {
        this._tree = tree;
        this._parent = parent;
        this._root = parent ? parent._root : this;
        this._values = parent ? undefined : {};
    }

    /** The values of the scope, the outer values are reachable through the prototype chain. */
    get values(): ObjectType {
        return this._values ?? this._parent!.values;
    }

    /** The outer scope, `undefined` for the root blackboard. */
    get parent() {
        return this._parent;
    }

    eval(code: string) {
        return this._tree.context.compileCode(code)(this.values);
    }

    get<T>(k: string): T | undefined {
        if (!k) {
            return undefined;
        } else if (this._parent && Blackboard._isInternalVar(k)) {
            return this._root._values![k] as T | undefined;
        } else {
            return (this._values ?? this._parent!.values)[k] as T | undefined;
        }
    }

    /**
     * Sets the variable of the scope, `undefined` or `null` deletes it. In an overlay, the
     * variable is set to `undefined` instead to shadow the outer one.
     */
    set<T>(k: string, v: T) {
        if (!k) {
            return;
        } else if (this._parent) {
            if (Blackboard._isInternalVar(k)) {
                this._root.set(k, v);
            } else {
                (this._values ?? this._ownValues())[k] = v ?? undefined;
            }
        } else if (v === undefined || v === null) {
            delete this._values![k];
        } else {
            this._values![k] = v;
        }
    }

    /** Whether the variable is set in this scope rather than an outer one. */
    hasOwn(k: string) {
        return !!this._values && hasOwn.call(this._values, k);
    }

    /** Creates an overlay of this scope. */
    fork() {
        return new Blackboard(this._tree, this);
    }

    /** Clears the variables of the scope in place, the overlays forked from it stay valid. */
    clear() {
        const values = this._values;
        if (values) {
            for (const k of Object.keys(values)) {
                delete values[k];
            }
        }
    }

    /**
     * Creates the values of the overlay on the first write. The outer overlay creates its values
     * first, so the prototype chain sees the later writes of every outer scope.
     */
    private _ownValues(): ObjectType {
        const parent = this._parent!;
        return (this._values = Object.create(parent._values ?? parent._ownValues()));
    }

    static makePrivateVar(k: string): string;

    static makePrivateVar(node: Node, k: string): string;

    static makePrivateVar(node: Node | string, k?: string) {
        if (typeof node === "string") {
            return `${PREFIX_PRIVATE}_${node}`;
        } else {
            return `${PREFIX_PRIVATE}_NODE#${node.id}_${k}`;
        }
    }

    static isPrivateVar(k: string) {
        return k.startsWith(PREFIX_PRIVATE);
    }

    static makeTempVar(node: Node, k: string) {
        return `${PREFIX_TEMP}_NODE#${node.id}_${k}`;
    }

    static isTempVar(k: string) {
        return k.startsWith(PREFIX_TEMP);
    }

    private static _isInternalVar(k: string) {
        return (
            k.charCodeAt(0) === 95 && (k.startsWith(PREFIX_PRIVATE) || k.startsWith(PREFIX_TEMP))
        );
    }
}
