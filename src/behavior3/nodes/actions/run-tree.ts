import { Blackboard } from "../../blackboard";
import { type Context } from "../../context";
import { ERROR, Node, NodeData, NodeDef, SKIP, Status } from "../../node";
import { registerNode } from "../../register-node";
import { Tree } from "../../tree";

type RunTreeState = {
    subtree: Tree<Context, unknown>;
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
    };

    private readonly _subtreesKey: string;

    constructor(context: Context, cfg: NodeData) {
        super(context, cfg);
        this._subtreesKey = Blackboard.makePrivateVar(this, "SUBTREES");
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
            const timeout = this.args.timeout;
            state = {
                subtree: this._subtree(tree, path),
                expired: timeout === undefined ? undefined : tree.context.time + timeout,
                started: false,
            };
        }

        const { subtree } = state;
        if (!subtree.ready) {
            if (state.expired !== undefined && tree.context.time >= state.expired) {
                this.warn(`load tree '${subtree.path}' timeout`);
                return "error";
            }
            tree.setState(this, state);
            return "running";
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
        tree.getState<RunTreeState>(this)?.subtree.interrupt();
    }

    override onClear(tree: Tree<Context, unknown>): void {
        tree.blackboard
            .get<Map<string, Tree<Context, unknown>>>(this._subtreesKey)
            ?.forEach((subtree) => subtree.clear());
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

    static override get descriptor(): NodeDef {
        return {
            name: "RunTree",
            type: "Action",
            group: ["Core"],
            children: 0,
            status: ["success", "failure", "running"],
            deferred: true,
            desc: "执行另一棵行为树",
            input: ["树路径?", "输入变量..."],
            output: ["输出变量..."],
            args: [
                { name: "path", type: "string?", desc: "树路径", oneof: "树路径" },
                { name: "timeout", type: "float?", desc: "加载超时时间" },
            ],
            doc: `
                + 在独立的行为树实例中执行 \`树路径\` 指定的树，子树看不到调用方的变量
                + 开始执行时，把输入变量的值传给子树，变量名相同
                + 子树成功时，把输出变量从子树写回调用方，变量名相同；失败和 \`error\` 时不写回
                + 输出变量是这一次执行的结果：每次开始执行前会清掉子树里的输出变量，这次没写的不会写回，调用方的变量保持不变；要跨多次执行累计的值，用别的变量名保存，结束前再赋给输出变量
                + 树还没加载时返回 \`running\`；填了 \`timeout\` 时，超时还没加载完返回 \`error\`
                + 子树抛异常时返回 \`error\`，不中断调用方
                + 不能放在条件树里，加载时报错：运行的树到运行时才加载，加载时检查不了；要复用条件，在编辑器里用子树
                + 同一个单位上，同一个节点对同一个路径复用同一个子树实例，\`clear\` 时一起清掉
            `,
        };
    }
}
