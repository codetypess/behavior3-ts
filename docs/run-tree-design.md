# RunTree 设计

> 状态：已实现。变量隔离和 `Scope` 的规则见 [scope-design.md](scope-design.md)。

`RunTree` 执行另一棵行为树，树的路径由输入决定。编辑器导出时会把静态引用的子树内联进来，`RunTree` 是给**运行时才确定路径**的情况用的。

## 1. 语义

`RunTree` 像一次函数调用：

```
主树
└── RunTree(input: path, hp, target; output: result)
    │   input：开始执行时把 hp、target 的值传进 treeA
    │   output：成功时把 treeA 的 result 写到调用方的当前作用域
    └── treeA（独立的 Tree 实例）
```

- **treeA 默认完全隔离**：它有自己的 `Tree` 实例、自己的黑板和节点状态，看不到调用方的任何变量，只能拿到 input 传进去的值；它内部的变量也一个都不会漏到调用方。
- **input 是参数**：决定把调用方的哪些变量传给 treeA。
- **output 是返回值**：决定把 treeA 的哪些变量交回调用方的**当前作用域**。声明在 output 里的变量就是调用方想要的结果，直接写进主树不算污染。

**`Scope` 是可选的**，只在 output 是中间结果、不应该留在主树里时才需要。比如拿到结果后，还要用兄弟节点加工一下，最后只交出加工后的值：

```
Scope(output: damage)                          ← 主树最终只多一个 damage
└── Sequence
    ├── RunTree(input: path; output: target, distance)
    └── Calculate(target.atk / distance) → damage
```

`target` 和 `distance` 留在 `Scope` 的覆盖层里，结束就丢掉。这和在主树任何一段逻辑外面套 `Scope` 的理由一样，不是 `RunTree` 特有的要求。

`Scope`、`RunTree`、treeA 各管一件事：`Scope` 管调用方的隔离，`RunTree` 管参数和返回值，treeA 管自己的逻辑。

## 2. 为什么用独立的 Tree 实例

另一种做法是在同一个 `Tree` 上直接 tick treeA 的根节点。这样会遇到下面的问题，用独立实例就都不存在了：

| 问题 | 同一个 Tree 上执行 | 独立 Tree 实例 |
|---|---|---|
| 节点状态 | 按 `node.index` 存储，而 index 每棵树都从 0 开始编号，会冲突 | 有自己的 `_states` |
| 私有变量 | `makePrivateVar` 按 `node.id` 生成键，不同树文件的 id 可能重复（都有 `Once#3`），会冲突 | 有自己的根黑板 |
| 中断 | `_abortAll` 沿主树的节点图找 running 节点，找不到 treeA 的节点 | `child.interrupt()` |
| 回调 | treeA 的 `Listen`/`Delay` 回调触发时，状态和作用域都是主树的 | 回调执行的是 child 自己 |
| 隔离 | 要另外实现 | 天然隔离 |

## 3. 节点定义

```ts
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
            { name: "keep", type: "bool?", desc: "保留子树实例", default: true },
        ],
        doc: `
            + 在独立的行为树实例中执行 \`树路径\` 指定的树，子树看不到调用方的变量
            + 开始执行时，把输入变量的值传给子树，变量名相同
            + 子树成功时，把输出变量从子树写回调用方，变量名相同；失败和 \`error\` 时不写回
            + 输出变量是这一次执行的结果：每次开始执行前会清掉子树里的输出变量，这次没写的不会写回，调用方的变量保持不变；要跨多次执行累计的值，用别的变量名保存，结束前再赋给输出变量
            + 树还没加载时返回 \`running\`；填了 \`timeout\` 时，超时还没加载完返回 \`error\`
            + 不能放在条件树里，加载时报错：运行的树到运行时才加载，加载时检查不了；要复用条件，在编辑器里用子树
            + 同一个单位上，同一个节点对同一个路径复用同一个子树实例
        `,
    };
}
```

- 树路径和 `Wait`、`Timeout` 一样，用 input 或 `path` 参数二选一。input 的第一个位置固定给树路径，后面的位置都是输入变量。
- `timeout` 只管**加载**，不管执行。要限制执行时间，在外面套 `Timeout`。

## 4. 实例复用

- 每个单位的每个 `RunTree` 节点、每个路径对应一个子树实例，缓存在 `RunTree` 自己的**私有变量**里（`Map<路径, Tree>`）。私有变量始终在根黑板（scope-design.md 第 2 节），放进 `Scope` 或条件树也一样，而且节点结束后不会被清掉。
- 子树实例是一个持久的“子 AI”：黑板、私有变量在多次执行之间保留，`Once` 表示“这个实例只执行一次”；`Listen` 注册的监听一直有效，回调执行的就是这个实例。
- 每次开始执行时，input 覆盖子树黑板里的同名变量。调用方的值是 `undefined` 时，删除子树里的这个变量，不留上一次的旧值。
- 每次开始执行时，先清掉子树黑板里的 output 变量，再传 input（第 8 节）。
- 缓存只在主树 `clear()` 时释放（第 6 节）。路径是动态的，路径种类多的话，每个单位都会缓存多个实例：实例数是 单位数 × `RunTree` 节点数 × 实际运行过的路径数，每个实例都留着自己的黑板、状态和注册的监听、定时器。
- **`keep` 参数（保留子树实例）**：默认 `true`，就是上面的持久实例。设为 `false` 时，每次执行都从干净的子树开始，像普通函数调用：
  - “每次执行”是从开始执行子树到这次执行结束：子树返回 running 跨多帧时，这几帧用同一个实例；返回 success／failure／error，或者 `RunTree` 被中止时，这次执行结束，立即 `clear()` 子树，它的变量、`Once` 标记、注册的监听和定时器都被移除，不会在两次执行之间触发。output 在清理之前导出。
  - 每个节点最多留一个实例（私有变量 `LAST`）：下次执行路径相同时复用它，不用新建 `Tree`、不用再调用 `loadTree`；路径不同时才换一个新实例。实例数最多是 单位数 × `RunTree` 节点数，不随路径种类增长，适合路径种类多的情况。
  - 实例记录“开始过一次执行、还没清理”，主树 `clear()` 时先中止 `RunTree`（`onAbort` 已经清理），`onClear` 不会再清一次。
  - 不做自动淘汰（LRU、容量上限）：被淘汰的实例的 `Once` 和监听会悄悄重置，行为取决于运行顺序，难以预料。保留还是用完即清，由写树的人按子树的写法选择。

```ts
// run-tree.ts
private readonly _subtreesKey: string;

constructor(context: Context, cfg: NodeData) {
    super(context, cfg);
    this._subtreesKey = Blackboard.makePrivateVar(this, "SUBTREES");
}

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

override onClear(tree: Tree<Context, unknown>) {
    tree.blackboard.get<Map<string, Tree<Context, unknown>>>(this._subtreesKey)?.forEach((v) => v.clear());
}
```

- `new Tree` 时会调用 `loadTree`，加载在创建实例时就开始了。`loadTree` 同步抛出的异常（比如创建节点时发现配置错误）直接抛给调用方；返回的 Promise 被 reject 时，`Tree` 打印一次错误，记在 `tree.loadError` 上，之后 `tick()` 返回 `error`（还在加载时返回 `failure`）。
- 缓存放在节点自己的私有变量里，`Tree` 不需要知道 `RunTree` 的存在。主树 `clear()` 时通过 `onClear` 通知节点清掉子树实例（4.1 节），私有变量随后随根黑板一起清掉。

### 4.1 Node.onClear

新增一个节点钩子，和 `onTick`、`onAbort` 一样由节点按需实现：

```ts
// node.ts
/**
 * Called when the tree is cleared, releases what the node keeps for the tree beyond a run:
 * subtree instances, caches in private vars, etc. Running nodes have been aborted before this call.
 */
onClear(tree: Tree<Context, unknown>): void {}
```

`Tree.clear()` 的顺序：

1. 派发 `TreeEvent.CLEANED`；
2. `interrupt()`：running 的节点先执行 `onAbort`（running 的 `RunTree` 在这里中断子树）；
3. **遍历所有节点调用 `onClear`**：和 `_abortAll` 一样沿 `children` 和 `conditions` 递归，异常 catch 住并打印，不影响其他节点；
4. 清空节点状态和根黑板（私有变量在这一步清掉，所以 `onClear` 必须在它之前）；
5. `offAll` 移除这棵树的监听和定时器。

- `clear` 很少调用，遍历整棵树的开销可以忽略；树还没加载好（没有 root）时跳过第 3 步。
- 嵌套的 `RunTree` 不用特殊处理：子树实例的 `clear()` 会遍历子树自己的节点，调用子树里 `RunTree` 的 `onClear`。
- 这个钩子不是 `RunTree` 专用的。宿主节点在私有变量里缓存了需要释放的资源（比如每个单位一份的对象池），也可以用它。

## 5. 执行流程

```ts
interface RunTreeState {
    subtree: Tree<Context, unknown>;
    /** 加载的截止时间，只在等待加载、填了 timeout 时有值 */
    expired?: number;
    /** 是否已经开始执行，开始时才传 input */
    started: boolean;
}

override onTick(tree: Tree<Context, unknown>): Status {
    let state = tree.getState<RunTreeState>(this);
    if (!state) {
        const path = this._checkOneof(0, this.args.path);
        if (path === ERROR) {
            return "error";
        }
        const subtree = this._subtree(tree, path);
        const timeout = this.args.timeout;
        state = {
            subtree,
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
        // 开始执行：先清掉上一次留下的输出变量，再按值传参
        for (const key of this.cfg.output) {
            if (key) {
                subtree.blackboard.unset(key);
            }
        }
        const keys = this.cfg.input;
        for (let i = 1; i < keys.length; i++) {
            subtree.blackboard.set(keys[i], this.input[i]);
        }
        state.started = true;
    }

    subtree.debug = tree.debug;
    const status = subtree.tick();

    if (status === "running") {
        tree.setState(this, state);
        return "running";
    }

    // 只在 success 时导出，子树里没有的变量不写
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

override onAbort(tree: Tree<Context, unknown>) {
    const state = tree.getState<RunTreeState>(this);
    state?.subtree.interrupt();
}
```

### 5.1 子树结果的映射

| 子树返回 | `RunTree` 返回 | 导出 |
|---|---|---|
| success | success | 导出子树里有的变量 |
| failure | failure | 不导出 |
| running | running | 不导出 |
| error | error | 不导出（框架在 error 时本来就不写 output） |
| interrupted | failure | 不导出 |
| exception | error，并 warn | 不导出 |

- **exception 转成 error**：子树已经在自己身上派发了 `TreeEvent.EXCEPTION`，并中断了自己。主树只让这个分支返回 error，不跟着中断。
- **interrupted**：只有子树里的节点调用了子树自己的 `interrupt()` 时才会出现（`RunTree` 被中止时，`RunTree` 已经不再返回结果）。

### 5.2 加载

| 情况 | 结果 |
|---|---|
| 已经加载 | 当帧开始执行 |
| 加载中，没填 `timeout` | 一直返回 running，直到加载完。没填表示写树的人保证一定能加载成功 |
| 加载中，填了 `timeout`，没到时间 | running |
| 加载中，填了 `timeout`，到时间还没加载完 | warn，返回 error |
| 加载失败（`loadTree` 的 Promise 被 reject） | warn，立即返回 error，不等 `timeout` |

- 截止时间从**这一次开始执行**算起，按 `tree.context.time` 计算，和 `Timeout` 一样。
- `timeout` 只限制**还没加载完**的情况。加载失败由 `Tree` 记下（`tree.loadError`），`RunTree` 看到就返回 error。
- **失败的子树实例保持失败，直到主树 `clear()`**：不会反复调用 `loadTree`，路径确实不存在时不会每次执行都重新加载、刷屏。主树 `clear()` 时实例被丢掉，之后再执行会新建实例、重新加载。需要重试（比如网络抖动），在 Context 的 `loadTree` 里实现：只有宿主知道失败的原因、该不该重试、隔多久重试。
- `RunTree` 声明了 `deferred`，不能放进条件树，加载时报错（第 7 节）。

## 6. 和主树的生命周期同步

| 主树发生的事 | 子树 |
|---|---|
| tick 到 `RunTree` | `subtree.tick()` |
| `RunTree` 被中止（抢占、父节点结束、`self` 条件不成立） | `onAbort` 调用 `subtree.interrupt()`，子树里 running 的节点照常执行 `onAbort` |
| 主树被中断 | `_abortAll` 调用 running 的 `RunTree` 的 `onAbort`，同上 |
| 主树 `clear()` | `RunTree.onClear` 依次 `clear()` 缓存的子树实例（4.1 节），缓存随根黑板一起清掉。子树的监听注册在子树自己身上，主树的 `offAll` 清不掉，所以必须这样做 |
| 主树开了 `debug` | tick 子树前同步 `debug` |

- 子树的 `TreeEvent`（`TICKED` 等）在子树实例上派发。子树里 `Listen` 内置事件，监听的是子树自己的 tick。
- 子树的 `Listen`/`Delay` 回调由子树自己的 `__tickInCallback` 执行，和主树的 tick、作用域、状态都无关。

## 7. 和作用域的关系

- `RunTree` 的 input 从调用方的**当前作用域**读，output 写到调用方的**当前作用域**，都由框架完成，和普通节点一样。
- 套在 `Scope` 里时，output 写进 `Scope` 的覆盖层，`Scope` 成功时再按自己的 output 导出。
- 子树内部照常使用作用域机制（`Scope`、条件树的隐式作用域），它的根黑板就是子树实例自己的黑板。
- **不能放进条件树**：`RunTree` 运行的树到运行时才加载，那棵树里的节点没有和条件树一起检查，可能含有 `Listen`、`Delay` 这类每次求值都会多注册一次回调的节点（design.md 4.4 节）。所以 `RunTree` 声明了 `deferred`，放进条件树（包括根节点是 `Scope` 的条件树）时加载报错。要复用条件逻辑，在编辑器里用子树，导出时会内联进来，和条件树一起检查；条件里按路径动态运行另一棵树没有必要支持。

## 8. 注意事项

- **递归**：treeA 里用 `RunTree` 执行 treeA，每一层都是不同的子树实例（缓存在上一层的实例上），本身没问题。无条件的递归会无限创建实例，由写树的人保证。
- **按值传参**：input 只在开始执行时传一次。子树 running 期间，调用方的变量再变不会同步过去。
- **导出不区分“没写过”和“清掉了”**：子树的黑板是根黑板，设成 `undefined` 就是删除，所以子树里没有的变量统一 `SKIP`，不会删除调用方的变量。
- **output 是这一次执行的结果**：子树实例是复用的，如果不清理，这次执行没写的 output 变量还留着上一次的值，成功时会被导出，覆盖调用方在两次执行之间改过或清掉的值（比如调用方用完 `target` 就清掉，下次子树没找到目标，却又导出了上次的 `target`）。所以每次开始执行时，先清掉子树里的 output 变量：这次没写就不导出，调用方的变量保持不变，和主树里节点“没写就不动”一致。output 由调用方的 `RunTree` 声明，同一棵子树在不同地方可能导出不同的变量，所以由框架清理，不交给写子树的人。既是 input 又是 output 的变量先被清掉、再被 input 写入，结果不变。要跨多次执行累计的值（计数器等），用别的变量名保存，结束前再赋给 output 变量。
- **性能**：每次 tick `RunTree` 都会执行一次完整的 `Tree.tick`，包括派发 `TICKED` 等事件。

## 9. 改动清单

| 文件 | 改动 |
|---|---|
| `node.ts` | 新增 `onClear(tree)` 钩子，默认空实现 |
| `tree.ts` | `clear()` 在 `interrupt()` 之后、清空状态和黑板之前，遍历所有节点（包括条件树）调用 `onClear` |
| `nodes/actions/run-tree.ts` | 新的 `RunTree` 节点，子树实例缓存在私有变量里，`onClear` 时清掉 |
| `index.ts` | import `nodes/actions/run-tree` |

**测试**

| 文件 | 覆盖内容 |
|---|---|
| `test/unit/nodes.test.ts` 或 `execution.test.ts` | `onClear`：`clear()` 时每个节点（包括条件树里的）都被调用一次；在 `onAbort` 之后、黑板清空之前；一个节点抛异常不影响其他节点；树没加载好时不调用 |
| `test/unit/run-tree.test.ts`（新增） | 隔离（子树读不到调用方变量）；input 只在开始时传、`undefined` 删除旧值；output 只在 success 时导出、没有的变量 `SKIP`；实例复用（黑板、`Once` 保留）；被中止时子树的 `onAbort`；主树中断；主树 `clear` 清掉子树的监听；加载中 running、超时 error、不填 `timeout` 一直 running；exception 转 error；error 不导出；`debug` 同步；套在 `Scope` 里时 output 不进主树 |

**示例和文档**

- 新增 `example/test-run-tree.json` 和它要执行的子树，在 `test/main.ts` 里加一个用例；
- 运行 `npm start` 重新生成 `example/node-config.b3-setting`；
- `design.md` 第 6 节和 `README.md` 的行为节点列表加上 `RunTree`；
- `design.md` 第 7 节：自定义节点“只实现 `onTick` 和 `onAbort`”改成也可以实现 `onClear`，说明它的调用时机；`README.md` 自定义节点部分同步。

## 10. 待定

无。
