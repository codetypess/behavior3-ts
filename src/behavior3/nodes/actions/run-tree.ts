import { Blackboard } from "../../blackboard";
import { type Context } from "../../context";
import { ERROR, Node, NodeData, NodeDef, SKIP, Status } from "../../node";
import { registerNode } from "../../register-node";
import { Tree } from "../../tree";

/** The instance of the runs not keeping it (`keep: false`), at most one per node. */
type LastInstance = {
    subtree: Tree<Context, unknown>;
    /** Started a run not cleared yet. */
    dirty: boolean;
};

type RunTreeState = {
    subtree: Tree<Context, unknown>;
    /** The instance is not kept after the run (`keep: false`). */
    last?: LastInstance;
    /** The deadline of loading, only when waiting for the tree with `timeout`. */
    expired?: number;
    /** Whether the subtree has started, the input is passed on start. */
    started: boolean;
};

/**
 * Runs another tree in an isolated instance, like calling a function: the input is passed to
 * the subtree on start, the output is exported from the subtree on success.
 */
@registerNode
export class RunTree extends Node {
    declare args: {
        readonly path?: string;
        readonly timeout?: number;
        /** Whether the instance keeps its state between runs, `true` by default. */
        readonly keep?: boolean;
    };

    /** The kept instances, by path. */
    private readonly _subtreesKey: string;
    /** The instance reused by the runs not keeping it (`keep: false`), at most one. */
    private readonly _lastKey: string;

    constructor(context: Context, cfg: NodeData) {
        super(context, cfg);
        this._subtreesKey = Blackboard.makePrivateVar(this, "SUBTREES");
        this._lastKey = Blackboard.makePrivateVar(this, "LAST");
    }

    override onTick(tree: Tree<Context, unknown>): Status {
        let state = tree.getState<RunTreeState>(this);
        if (!state) {
            const path = this._checkOneof(0, this.args.path);
            if (path === ERROR) {
                return "error";
            } else if (typeof path !== "string" || !path) {
                this.warn(`invalid tree path: ${path}`);
                return "error";
            }
            const { timeout } = this.args;
            const last = this.args.keep === false ? this._last(tree, path) : undefined;
            state = {
                subtree: last ? last.subtree : this._subtree(tree, path),
                last,
                expired: timeout === undefined ? undefined : tree.context.time + timeout,
                started: false,
            };
        }

        const { subtree } = state;
        if (!subtree.ready) {
            if (subtree.loadError) {
                // stays failed until the caller is cleared, retrying is up to `loadTree`
                this.warn(`load tree '${subtree.path}' failed`);
                return "error";
            } else if (state.expired !== undefined && tree.context.time >= state.expired) {
                this.warn(`load tree '${subtree.path}' timeout`);
                return "error";
            }
            tree.setState(this, state);
            return "running";
        }

        if (subtree.executing) {
            // a callback of the subtree ticks this tree, which comes back to the subtree: checked
            // before the input is written, the subtree is in the middle of the callback
            this.throw(
                `tree '${subtree.path}' is executing (a callback, an abort or a clear), it can't be run ` +
                    `again until it returns (it ticks '${tree.path}'?)`,
            );
        }

        if (!state.started) {
            const { blackboard } = subtree;
            // the output is the result of this run: the value left by the last run is removed,
            // otherwise a run not writing it would export the stale value over the caller's one
            for (const key of this.cfg.output) {
                if (key) {
                    blackboard.unset(key);
                }
            }
            // passed by value on start, `undefined` deletes the value left by the last run
            const keys = this.cfg.input;
            const input = this.input;
            for (let i = 1; i < keys.length; i++) {
                blackboard.set(keys[i], input[i]);
            }
            state.started = true;
            if (state.last) {
                state.last.dirty = true;
            }
        }

        subtree.debug = tree.debug;
        const status = subtree.tick();

        if (status === "running") {
            tree.setState(this, state);
            return "running";
        }

        // only exported on success, a variable not in the subtree leaves the caller's one;
        // the framework writes the output on failure too, SKIP leaves the caller's variables
        const keys = this.cfg.output;
        for (let i = 0; i < keys.length; i++) {
            const value = status === "success" ? subtree.blackboard.get(keys[i]) : undefined;
            this.output[i] = value === undefined ? SKIP : value;
        }
        if (state.last) {
            // the run is over: its variables, listeners and timers are removed now
            RunTree._clearLast(state.last);
        }

        if (status === "exception") {
            this.warn(`tree '${subtree.path}' threw an exception`);
            return "error";
        } else if (status === "interrupted") {
            return "failure";
        } else {
            return status;
        }
    }

    override onAbort(tree: Tree<Context, unknown>): void {
        const state = tree.getState<RunTreeState>(this);
        if (state?.last) {
            // clear interrupts it first
            RunTree._clearLast(state.last);
        } else {
            state?.subtree.interrupt();
        }
    }

    override onClear(tree: Tree<Context, unknown>): void {
        tree.blackboard
            .get<Map<string, Tree<Context, unknown>>>(this._subtreesKey)
            ?.forEach((subtree) => subtree.clear());
        // not cleared again if its run has been aborted just before
        const last = tree.blackboard.get<LastInstance>(this._lastKey);
        if (last) {
            RunTree._clearLast(last);
        }
    }

    private static _clearLast(last: LastInstance) {
        if (last.dirty) {
            last.dirty = false;
            last.subtree.clear();
        }
    }

    /** The subtree instance of the path, reused by this node of the tree. */
    private _subtree(tree: Tree<Context, unknown>, path: string) {
        let subtrees = tree.blackboard.get<Map<string, Tree<Context, unknown>>>(this._subtreesKey);
        if (!subtrees) {
            subtrees = new Map();
            tree.blackboard.set(this._subtreesKey, subtrees);
        }
        let subtree = subtrees.get(path);
        if (!subtree) {
            subtree = new Tree(tree.context, tree.owner, path);
            subtrees.set(path, subtree);
        }
        return subtree;
    }

    /**
     * The instance of a run not keeping it: the one of the last run if it has the same path (it
     * was cleared when that run ended), otherwise a new one replacing it.
     */
    private _last(tree: Tree<Context, unknown>, path: string): LastInstance {
        let last = tree.blackboard.get<LastInstance>(this._lastKey);
        if (last?.subtree.path !== path) {
            if (last) {
                RunTree._clearLast(last);
            }
            last = { subtree: new Tree(tree.context, tree.owner, path), dirty: false };
            tree.blackboard.set(this._lastKey, last);
        }
        return last;
    }

    static override get descriptor(): NodeDef {
        return {
            name: "RunTree",
            type: "Action",
            group: ["Core"],
            children: 0,
            status: ["success", "failure", "running"],
            deferred: true,
            desc: "在独立实例中执行另一棵行为树",
            input: ["树路径?", "输入变量..."],
            output: ["输出变量..."],
            args: [
                { name: "path", type: "string?", desc: "树路径", oneof: "树路径" },
                { name: "timeout", type: "float?", desc: "加载超时时间" },
                { name: "keep", type: "bool?", desc: "保留子树实例", default: true },
            ],
            doc: `
                + 在独立的行为树实例中执行 \`树路径\` 指定的树，子树看不到调用方的变量
                + 开始执行时，把输入变量的值传给子树，变量名相同
                + 子树成功时，把输出变量从子树写回调用方，变量名相同；失败和 \`error\` 时不写回
                + 输出变量是这一次执行的结果：每次开始执行前会清掉子树里的输出变量，这次没写的不会写回，调用方的变量保持不变；要跨多次执行累计的值，用别的变量名保存，结束前再赋给输出变量
                + 树还没加载时返回 \`running\`；填了 \`timeout\` 时，超时还没加载完返回 \`error\`
                + 树加载失败时返回 \`error\`，直到清理行为树前都不会重新加载；需要重试的话，在 Context 的 \`loadTree\` 里实现
                + 子树抛异常时返回 \`error\`，不中断调用方
                + 不能放在条件树里，加载时报错：运行的树到运行时才加载，加载时检查不了；要复用条件，在编辑器里用子树
                + \`保留子树实例\`（默认开启）：同一个单位上，同一个节点对同一个路径复用同一个子树实例，子树的变量、\`Once\`、侦听和定时器在多次执行之间保留，清理行为树时一起清掉；路径种类多时，每个路径都会留下一个实例
                + 关闭 \`保留子树实例\`：每次执行都从干净的子树开始，像普通函数调用；这次执行结束（包括被中止）时清理子树，它注册的侦听和定时器随之移除。每个节点最多留一个实例，路径和上次相同时复用，不同时替换，适合路径种类多的情况；子树里依赖实例保留的节点（\`Once\`、\`Listen\`、\`Delay\`）在这种模式下只在这次执行期间有效
            `,
        };
    }
}
