# behavior3-ts 设计

本文是运行时的设计说明。打断与抢占的逐帧例子和使用建议见 [abort-mechanism.md](abort-mechanism.md)，编辑器需要配合的部分见第 9 节，和 1.x 的区别见第 12 节。

## 1. 概述

- **树和单位分开**：同一个树文件只创建一份 Node 实例，存在 `context.trees[path]` 里，所有单位共享。每个单位有自己的 `Tree`，运行状态和黑板都存在 Tree 上。节点身上只有 `input`、`output` 和 `json` 参数是一次调用的数据，节点在执行中被重入时（递归 `RunTree`、同步 tick 同一路径的另一棵树），`Node.tick` 保存外层调用的这些数据，内层结束后原地恢复。
- **每帧从根节点执行**：每次 `tree.tick()` 都从根节点出发，沿着 running 的路径往下执行。执行路径上的每个节点每帧都会被执行到，所以挂在祖先节点上的条件每帧都能重新判断。
- **条件与打断**：节点上可以挂条件，参考 UE（Unreal Engine）行为树的装饰器打断（Observer Aborts），按 `none` / `self` / `lower` / `both` 四种模式，在节点运行期间打断自己，或者让高优先级的分支抢占正在运行的低优先级分支（第 4 节）。
- **四种节点状态**：`success`、`failure`、`running`、`error`。`error` 表示数据不可信，和代码 bug 引起的异常分开处理（第 3 节）。

## 2. 执行模型

### 2.1 每帧从根节点执行

`tree.tick()` 调用 `root.tick()`，父节点在 `onTick` 里调用 `child.tick()`，直接拿到子节点的返回值：

```ts
// Sequence 示意
onTick(tree) {
    let i = tree.getState<number>(this) ?? 0;   // 从上次 running 的子节点继续
    for (; i < children.length; i++) {
        const status = children[i].tick(tree);
        if (status === "running") {
            tree.setState(this, i);
            return "running";
        } else if (status === "failure" || status === "error") {
            return status;
        }
    }
    return "success";
}
```

`Node.tick` 不允许重写，节点只实现 `onTick`。`Node.tick` 负责：

1. 检查条件（第 4 节）；
2. 从黑板读取 input，准备 `json` 参数的副本（第 5 节）；
3. 调用 `onTick`，捕获异常（3.4 节）；
4. 节点结束时写回 output，中止仍在运行的子节点，清除自己的状态；返回 running 时记录运行状态。

`node.tick()` 只能由父节点或框架调用，外部一律用 `tree.tick()`。节点抛异常时要靠 `tree.tick()`（或回调）把这一次执行退出来，绕开 Tree 直接调用时只会得到 `failure`。

### 2.2 节点状态

```ts
tree.getState<T>(node): T | undefined
tree.setState(node, value)      // 返回 running 时设置，节点结束或被中止时由框架清除
tree.isRunning(node)
```

- 构建树时给每个节点（包括条件树里的节点）分配连续的 `index`，状态存在 Tree 的数组里，按下标读写。数组保持紧凑，不留空洞，稀疏数组在 V8 里明显更慢。
- 节点返回 running 但没有设置状态时，框架记一个内部标记：`isRunning` 为 true，`getState` 返回 `undefined`。
- 一个节点在 running，它的父节点也一定在 running，所以从任意一个节点往下，沿着 running 的子节点就能找到所有还在运行的节点。
- 黑板只用来放业务变量。需要跨越多次执行的持久状态（比如 `Once` 的"已执行"标记）存在黑板的私有变量里（`Blackboard.makePrivateVar`），中断不会清除，`tree.clear()` 才会。临时变量（`Blackboard.makeTempVar`）在中断时清除。

### 2.3 中止（abort）

```ts
abort(tree): void        // 递归：先中止 running 的子孙，再调用 onAbort，最后清除状态；不允许重写
onAbort(tree): void      // 节点自己清理：停止移动、移除监听和定时器等
```

- **显式中止**：组合节点切换分支、或者自己被中止时，主动调用 `child.abort(tree)`，保证旧分支先清理完、新分支才开始。
- **结束时的中止**：节点返回 running 以外的结果时，框架对它仍在 running 的子节点调用 `abort()`。所以 Race 一个子节点成功、Timeout 超时、Parallel 结果确定时，其他还在运行的分支都会被清理。
- 被中止的节点状态被清除，下次执行从头开始。
- `onAbort` 里的异常只打日志，不影响中止流程。
- **debug 模式下检查漏掉的中止**：结束时的中止只覆盖"节点结束"的情况。组合节点自己一直 running、中途换了分支却没有中止旧分支时，旧分支的状态会残留，下次进入会从残留状态继续执行。`tree.debug` 开启时，每次 tick 结束检查"仍在 running、但这一帧没有被执行到"的节点，打印 warning。故意不每帧执行 running 子节点的自定义节点（比如节流）会被误报。

### 2.4 中断（interrupt）

`tree.interrupt()` 中止整棵树：

- 调用时立即派发 `TreeEvent.INTERRUPTED`。
- 节点在**最外层的执行退出时**中止（2.6 节）：遍历整棵树（包括条件树），对所有有状态的节点调用 `onAbort`，清空状态和临时变量。
- 在 tick 过程中调用时，`Node.tick` 一进入就直接返回 running，这一帧不再执行任何节点（包括 Parallel 后面的兄弟节点）。tick 退出时中止，`tree.tick()` 返回 `"interrupted"`。
- 在回调里调用时，回调剩下的代码执行完再中止（比如 `Delay` 先恢复暂存变量，`onAbort` 看到的是树的值，写的值也不会被覆盖），和 `clear()` 一样。
- 从调用 `interrupt()` 到节点中止完，树处于**拆除中**（2.6 节）：这段时间里触发的回调不执行这棵树的节点。
- 树空闲时调用立即中止；树没有在运行时什么都不做。
- 一次中断只派发一次 `INTERRUPTED`：从调用 `interrupt()` 到节点中止完，再调用 `interrupt()`（比如在 `INTERRUPTED` 的监听或 `onAbort` 里）什么都不做。
- 下一帧从根节点重新开始。

### 2.5 Tree 的状态和事件

`tree.tick()` 的返回值和 `tree.status`：

| 值 | 含义 |
|---|---|
| `success` / `failure` | 根节点返回的结果 |
| `running` | 根节点还在运行 |
| `error` | 根节点返回 `error`：error 一直传到根节点都没有被处理（3.1 节） |
| `interrupted` | 这一帧调用了 `tree.interrupt()`；在 tick 中调用 `tree.clear()` 时，这次 `tick()` 也返回它，清理之后 `status` 是 `success` |
| `exception` | 这一帧有节点抛了异常，整棵树被中断（3.4 节）；和 `interrupted` 同时发生时以它为准 |

`TreeEvent`（通过 `context.on(event, tree, callback, tag)` 监听）：

| 事件 | 时机 |
|---|---|
| `BEFORE_TICKED` | 根节点不在 running，开始新的一轮执行之前 |
| `AFTER_TICKED` | 根节点返回 `success`、`failure` 或 `error`，这一轮结束 |
| `TICKED_SUCCESS` / `TICKED_FAILURE` | 根节点返回 `success` / `failure` |
| `INTERRUPTED` | 树被中断 |
| `EXCEPTION` | 节点抛异常，参数是 `(error: Error, node: Node)` |
| `CLEANED` | 调用 `tree.clear()`；在执行中调用时，等执行退出后才派发 |

监听抛异常时打印日志（带树的路径、事件名和调用栈），其余的监听照常调用，树也照常继续，和 `onAbort`、`onClear` 抛异常的处理一样。比如 `CLEANED` 的监听出错，清理仍然完整做完。

### 2.6 生命周期规则

Tree 的这些过程都算**执行**（`tree.executing` 为 true）：`tick`、回调里执行节点（`Listen`、`Delay`）、`bindCallback` 绑定的回调、`interrupt()`（派发 `INTERRUPTED`、中止节点）、`clear()` 清理。在执行中调用 `tick`、`interrupt`、`clear` 的结果（以 A、B 两个节点 running 为例，`test/unit/lifecycle.test.ts` 按这张表逐格测试）：

| 在哪里调用 | `tick()` | `interrupt()` | `clear()` |
|---|---|---|---|
| 树空闲 | 正常执行 | 派发 `INTERRUPTED`，立即中止 A、B，`status` 为 `interrupted` | 立即清理 |
| tick 中的节点 | 抛 `already ticking`，作为节点异常，树以 `exception` 结束 | 这一帧结束时中止，`tick()` 返回 `interrupted` | tick 退出时清理，`tick()` 返回 `interrupted` |
| tick 外的回调里的节点 | 抛异常，只停下这次回调 | 回调结束后中止 | 回调退出时清理 |
| tick 中触发的回调里的节点 | 抛 `already ticking`，只停下这次回调 | 交给 tick，这一帧结束时中止 | tick 退出时清理 |
| `bindCallback` 绑定的回调 | 抛异常给回调的调用方 | 回调退出时中止 | 回调退出时清理 |
| 中断时的 `INTERRUPTED` 监听、`onAbort` | 抛异常，打日志 | 什么都不做（同一次中断） | 所有节点中止完后清理 |
| 清理时的 `onAbort`、`CLEANED` 的监听、`onClear` | 抛异常，打日志 | 什么都不做，或者在清理之前中止（`CLEANED` 的监听里） | 忽略 |

执行中不能 tick 的报错是 `is executing (a callback, an abort or a clear)`。

节点什么时候停下由**停止范围**决定：`tick` 和回调里执行节点（`__tickInCallback`）各建立一个范围，`bindCallback` 绑定的回调、中止和清理沿用当前的范围。节点在回调的范围里抛异常，只停下这个范围（这次回调后面的节点不再执行）；在 tick 的范围里抛异常，中断整棵树。`interrupt`、`clear` 停下栈上所有的范围，节点在最外层的执行退出时中止（有待执行的清理时，由清理来中止），中断和清理的时机相同。

从调用 `interrupt()`、`clear()` 到节点中止完、清理完，树处于**拆除中**（`tree.__tearingDown`）。这段时间里同步派发的事件（比如 `INTERRUPTED`、`CLEANED` 的监听、`onAbort`、`onClear` 里派发的，或者 tick 中断之后这一帧剩下的部分派发的），事件本身照常派发，宿主的监听、别的树都照常收到；只是这棵树的回调不执行节点：`Listen` 不写 output、不执行子节点，`Delay` 等回调里的子节点不执行，`tree.debug` 开启时打印 warning。树马上就要被中止、清空，在它上面执行的节点留下的状态要么马上被清掉，要么留在一棵已经不在运行的树上。`Listen` 监听树自己的事件（`INTERRUPTED`、`CLEANED` 等）除外，子节点照常执行，中断、清理时要做的收尾放在这里。

这张表保证的不变量：

- **最外层退出后才中止、清理**：执行中调用 `interrupt`、`clear` 只标记停止，最外层的执行退出时，在同一个调用栈里中止、清理。
- **每个节点只中止、清理一次**：一次中断或清理中，每个 running 的节点 `onAbort` 只调用一次，每个节点 `onClear` 只调用一次。
- **一次中断只派发一次 `INTERRUPTED`**，一次清理只派发一次 `CLEANED`；中断后又清理时，`INTERRUPTED` 不再重复派发。
- **执行中不能 tick**：不会在节点、回调、中止或清理的中间把整棵树再跑一遍。
- 执行结束后 `executing`、`ticking` 都是 false，当前作用域回到根黑板。

## 3. error 与异常

| | error 状态 | 异常 |
|---|---|---|
| 含义 | 节点发现**运行时数据不可信**，没法给出 success/failure：id 非法、输入类型不对、缺少必需的输入、Math 参数不合法、结果是 NaN 等 | **代码或配置有 bug**：节点代码里的 TypeError、游戏接口抛错、节点主动 `this.throw(msg)`、加载时的配置错误 |
| 怎么产生 | `onTick` 返回 `"error"` | `throw` |
| 传递 | 逐层返回 `"error"`，直到被 `ErrorToFailure` 转成 failure | 中断整棵树 |
| 日志 | `warn`，带树名、节点 id 和原因 | `error`，带调用栈 |
| 事件 | 无 | `TreeEvent.EXCEPTION` |
| `tree.tick()` 返回 | 没有被处理时返回 `"error"` | `"exception"` |

- **failure 只表示正常的否定结果**：没有敌人、不是英雄、数组里不包含这个值等，父节点据此选分支。
- **数据不可信就返回 error**，不能返回 failure。比如 IsHero 拿到非法 id 时如果返回 failure，后面的分支会把它当成小兵继续执行，但它其实也不是小兵。

### 3.1 传递规则

**节点收到子节点的 `"error"`，自己也返回 `"error"`，只有 `ErrorToFailure` 例外。**

- 内置的组合节点和装饰节点都这样处理：Selector 不执行下一个分支，Parallel、Race 不执行后面的子节点，Invert、AlwaysSuccess、AlwaysFailure、Repeat、Retry、ForEach、Timeout 等原样返回 `"error"`。
- `ErrorToFailure`（装饰节点）：子节点返回 `"error"` 时返回 `"failure"`，其他结果原样返回。这条分支出错，交给其它分支处理：

```
Selector
├─ ErrorToFailure      ← 子树返回 error → failure，Selector 接着试下一个分支
│  └─ Sequence
│     ├─ IsHero        ← id 非法：返回 error
│     └─ 英雄逻辑
├─ Sequence
│  ├─ IsMinion
│  └─ 小兵逻辑
└─ 默认逻辑
```

- **error 只是一个返回值**：Tree 上没有"出错"的标记，`Node.tick` 也不改写节点的返回值，传递 error 完全靠每个节点自己。自定义的组合节点和装饰节点漏处理时（比如把它当成 failure 去执行下一个分支），框架不会拦。
- **error 是结束状态**，走正常的结束流程：不写 output（结果不可信）；中止仍在 running 的子节点，清除自己的状态。每一层返回时清理自己这一层，所以 Parallel 其他在运行的分支、Selector 记下的下标都会被清掉，下一次从头执行。不中断整棵树，不清临时变量。
- **条件只有 true 和 false**：挂在节点上的条件树返回 error 时，条件为 false，不运行被装饰的节点（4.3 节）。主树里的条件节点（比如 Selector 下的 IsHero）是普通节点，照常传递 error。
- **没有被处理**：一直传到根节点时，`tree.tick()` 返回 `"error"`，树和返回 success/failure 一样正常结束，下一帧从根节点开始。

### 3.2 在节点里返回 error

```ts
override onTick(tree: Tree<Context, unknown>): Status {
    const [id] = this.input;
    if (typeof id !== "number") {
        this.warn(`invalid id: ${id}`);
        return "error";
    }
    return isHero(id) ? "success" : "failure";
}
```

辅助函数没法替节点返回状态，出错时返回专用值 `ERROR`（模块级的 `unique symbol`），调用方判断后返回 `"error"`。返回类型是 `V | typeof ERROR`，不判断就当成 `V` 使用会编译报错；也不用像返回 tuple 那样每次分配数组（`_checkOneof` 在 Wait、Repeat、Timeout 等节点里每帧都会调用）：

```ts
const field = this._checkOneof(1, args.field);   // 缺少必需的输入：打印 warning，返回 ERROR
if (field === ERROR) return "error";
```


表达式求值器用 `throw` 报运行时错误（不是对象、不是数字、找不到等），`blackboard.eval` 也会抛出；Check、Calculate 在调用处捕获，打印 warning 后返回 `"error"`。

### 3.3 内置节点返回 error 的情况

执行时数据不对一律返回 `error`，并打印 warning 说明原因：

| 节点 | 情况 |
|---|---|
| Concat、Push、Index、RandomIndex、Filter、ForEach、Includes | 输入的数组不是数组 |
| Index | 下标不是数字 |
| GetField、SetField | 对象不是对象，field 不是字符串或数字 |
| Math | 参数个数不对、最小值大于最大值、结果是 NaN |
| Check、Calculate | 表达式求值出错，比如引用不存在的变量、对非对象取属性 |
| Assert | 子节点返回 failure，message 打在 warning 里 |
| 有必需输入的节点 | 输入没有默认值，黑板上又不存在（`_checkOneof`），比如 GetField/SetField 的 field、Index 的下标 |

### 3.4 异常

**`tree.tick()` 里的异常**

1. 抛异常的节点在自己的 `Node.tick` 里捕获，打印带树名、节点 id 和调用栈的错误日志。
2. 派发 `TreeEvent.EXCEPTION`，参数是 `(error: Error, node: Node)`，抛出的不是 `Error` 时包装成 `Error`。游戏可以在这里统一上报、禁用这棵树等。Listen 不提供这个事件：异常由游戏代码处理，树不处理自己的 bug（也避免 Listen 的子节点出错后再次触发 EXCEPTION 形成死循环）。
3. 中断整棵树（2.4 节），父节点拿到的是 running，不会误判。`ErrorToFailure` 不处理异常。
4. `tree.tick()` 返回 `"exception"`，表示**这一帧有节点抛了异常**。下一帧从根节点重新开始，返回正常的结果。

**加载时的异常**（节点重写了 `tick` 或 `abort`、abort 取值不合法、子节点数量不够、Switch 下放了 Case 以外的节点、Math 的 op 不认识、Parallel 的 `successCount` 不合法、表达式编译不过等）不捕获，直接抛给加载树的调用方。

### 3.5 异步回调里的 error 和异常

`Listen`、`Delay` 在事件或定时器回调里执行子节点，这和 `tree.tick()` 无关，所以回调里出错**不影响主树**：不中断，`tree.status` 不变，主树正在 running 的分支继续执行。

- 回调通过内部方法 `tree.__tickInCallback(node)` 执行子树，相当于一次只针对这棵子树的独立执行。
- 注册回调时用 `tree.bindCallback(fn)` 包一层，回调就在注册时的作用域里执行（[scope-design.md](scope-design.md) 第 8 节）。
- 子树返回 `"error"` 时只打印日志。`ErrorToFailure` 要放在回调的子树里面才有效，包在 Listen 外面处理不到。
- 抛异常时同样打印日志、派发 `TreeEvent.EXCEPTION`，然后只停下这棵子树：这次回调里不再执行任何节点。
- 子树执行完后，中止其中所有 running 的节点（回调里的子树不能跨帧运行）。
- 事件在主树 tick 过程中同步派发时，也按回调处理，不影响这一次 tick。
- 回调里的节点主动调用 `tree.interrupt()` 仍然中断整棵树，最外层的执行退出时生效：绑定的回调剩下的代码执行完之后（在 tick 过程中则在这一帧结束时）。
- 树被中断、清理的过程中（2.6 节"拆除中"），回调不执行节点，`Listen` 监听树自己的事件除外。
- 回调执行中（以及中止节点、清理的过程中，见 2.6 节）不能 tick 这棵树，和在节点里 tick 自己的树一样抛异常：回调的节点还在栈上，整棵树不能在它中间再跑一遍。tick 别的树可以，但子树的回调 tick 了调用方、调用方又通过 `RunTree` 回到这棵子树时，`RunTree` 在写入输入之前抛异常，日志的调用栈里能看到整个环。`tree.executing` 表示树正在执行。

## 4. 条件与打断

### 4.1 和 UE 的对应关系

| UE | behavior3-ts |
|---|---|
| 挂在节点上的条件装饰器（Decorator） | 节点的 `conditions` 数组中的一项 |
| 装饰器的判断逻辑 | 条件树 `root`：一棵普通的行为树，结果只有 true 和 false |
| Observer Aborts：None / Self / Lower Priority / Both | `abort`：`none` / `self` / `lower` / `both` |
| `UBTCompositeNode::CanAbortLowerPriority()`（Selector 支持，Sequence 不支持） | NodeDef 的 `preemptive` 标记（内置只有 Selector） |
| Lower Priority 的作用范围：同一个组合节点下、优先级更低的分支 | 同一个父节点下、右侧的兄弟分支 |
| 打断后中止正在运行的任务，从被装饰的分支开始执行 | abort 正在运行的子节点 j，从子节点 i 开始执行 |

语义上和 UE 一致，实现方式的差异见 4.7 节。

### 4.2 树文件格式

```jsonc
{
  "id": "3",
  "name": "Sequence",
  "conditions": [                  // 条件数组，项与项之间是 AND
    {
      "abort": "both",             // none | self | lower | both，默认 none；作用于整棵条件树
      "root": {                    // 条件树的根节点，和普通节点的数据格式完全一样
        "id": "3.1-1",
        "name": "Selector",
        "children": [
          { "id": "3.1-2", "name": "Check", "args": { "value": "hp < 20" } },
          { "id": "3.1-3", "name": "Sequence", "children": [
              { "id": "3.1-4", "name": "IsStatus", "args": { "status": "stunned" } },
              { "id": "3.1-5", "name": "Invert", "children": [ { "id": "3.1-6", "name": "HasShield" } ] }
          ] }
        ]
      }
    }
  ],
  "children": [ ... ]
}
```

```ts
type AbortMode = "none" | "self" | "lower" | "both";

interface ConditionData {
    abort?: AbortMode;   // 默认 none
    root: NodeData;      // 条件树
}

interface NodeData {
    // ……
    conditions?: ConditionData[];
}
```

- 条件树本身就是一棵行为树。树内部的 AND 用 `Sequence`，OR 用 `Selector`，取反用 `Invert`，都复用现有节点。
- **abort 写在条件项上，不写在节点上**，作用于整棵条件树。这样条件树里的节点和普通节点格式一致，编辑器和运行时都可以直接复用节点解析；一棵带 OR 的树也没法只判断其中一部分，所以不给树内部的节点单独配置 abort。
- 一个节点可以挂多项条件，类似 UE 在一个节点上挂多个装饰器。
- 可以通过子树引用条件文件，比如 `cond/can-attack.json`，在多个节点之间复用。子树由编辑器导出时展开。
- 条件树里的节点不占主树的编号：宿主第 n 项条件（从 1 数）的条件树里，节点 id 是 `<宿主 id>.<n>-<k>`，`k` 在这棵条件树内按节点、子节点的顺序从 1 数（上例的 `3.1-1` 到 `3.1-6`）。这样增删条件不会让主树节点改号。树的 `prefix` 加在最前面（`H3.1-1`）。运行时只把 id 当字符串用（日志里显示成 `Check#3.1-2`），状态数组用的是 `index`，和 id 无关。
- 条件树内部不允许再挂条件。

### 4.3 语义

设节点 `N` 挂了条件 `C1, C2, ..., Cn`，每一项有自己的 abort 模式；`N` 是组合节点 `P` 的第 i 个子节点。

| 时机 | 检查哪些项 | 结果 |
|---|---|---|
| **进入** `N`（N 不在 running） | **全部**项 | 有任何一项为 false：不进入，返回 failure |
| **重入** `N`（N 正在 running） | 只检查 abort 为 `self` 或 `both` 的项 | 有任何一项为 false：abort `N` 的子树，返回 failure |
| `P` 准备重入正在 running 的子节点 j（j > i）之前，并且 `P` 是 preemptive | 至少有一项是 `lower` 或 `both` 时才判断；判断时检查**全部**项 | 全部为 true：abort 子节点 j，从子节点 i 开始执行 |

- 各项按数组顺序求值，遇到第一个 false 就停止（短路）。
- 条件树返回 error 时，这一项为 false：数据不可信，就不运行被装饰的节点。进入时不进入；重入时 abort `N`，返回 failure；抢占检查时不抢占。
- 抢占时检查**全部**项，标准和"进入"一致。`lower` 只决定"要不要去判断"，真正能不能抢占要看全部条件。这样可以避免"抢占成功、一进去就失败"：比如 `[HasEnemy(lower), HpAbove50(none)]`，只有发现敌人并且血量足够时才会打断巡逻。
- abort 为 `none` 的项只在进入时判断（以及作为抢占时的附加条件），效果等同于放一个前置 Condition 子节点，好处是树更扁。

例子：

```jsonc
"conditions": [
  { "abort": "both", "root": { "id": "3.1-1", "name": "HasEnemy" } },     // A
  { "abort": "self", "root": { "id": "3.2-1", "name": "HpAbove50" } },    // B
  { "abort": "none", "root": { "id": "3.3-1", "name": "NotStunned" } }    // C
]
// 为了简短，这里每棵条件树都只有一个节点；实际可以是任意深度的树
```

| 时机 | 参与判断的项 | 行为 |
|---|---|---|
| 进入 | A && B && C | |
| 重入（self） | A && B | 攻击中血量掉到 50 以下：打断；攻击中被眩晕：**不会**打断，因为 C 是 none |
| 抢占（lower） | 有 A，所以要判断：A && B && C | 巡逻中发现敌人，并且血量够、没被眩晕：打断巡逻去攻击 |

- **作用域**：lower 只能抢占**同一个父节点下、右侧的兄弟分支**，和 UE 一致。条件挂在更深的节点上时，由它的直接父节点负责检查；那个父节点不在 running 路径上时，这个条件就不会被检查。
- 每帧从根节点沿 running 路径往下，路径上**每个** preemptive 祖先都会检查自己左侧的子节点。离根越近越先检查，所以外层的高优先级分支能先抢占。
- 条件在阈值附近抖动导致分支频繁切换的问题，框架不处理，由条件自己做滞回。

### 4.4 条件树的约束

条件树可能每帧都被求值，而且是一次性求值，**不能返回 running**。分工如下：

- **编辑器负责校验**：根据 NodeDef 的 `status` 做静态推导，不合法的配置在编辑器里就拦住。
- **运行时负责保证**：不做静态推导，只在求值时检查返回值。就算树文件没经过编辑器校验，运行时的行为也是确定的。

**编辑器：用 `status` 推导**

- `status` 包含 `"running"`：节点**自己**会返回 running，不允许放进条件树。比如 Wait、WaitForEvent、AlwaysRunning、RetryUntilSuccess、RetryUntilFailure。
- `status` 包含 `"|running"`：只有子节点返回 running 时它才会返回 running，**递归检查子节点**。比如 Sequence、Selector、Invert、AlwaysSuccess/Failure、IfElse、Switch。
- 两者都不包含：允许。比如 Check、IsNull、NotNull、Includes。

```ts
function canRun(cfg: NodeData, defs: Record<string, NodeDef>): boolean {
    const status = defs[cfg.name]?.status;
    if (!status) return false;                      // 没声明 status：不检查，交给运行时
    if (status.includes("running")) return true;
    if (status.includes("|running")) return cfg.children.some((c) => !c.disabled && canRun(c, defs));
    return false;
}
```

自定义节点没声明 `status` 时，编辑器不检查，由运行时的返回值检查保证。所以**自定义的条件节点应该声明 `status`**，编辑器才能提前拦住。

**推迟到运行时的节点不能放进条件树**：NodeDef 声明了 `deferred` 的节点，工作推迟到运行时，加载时检查不了。有两种：注册的回调在节点返回之后才执行（`Listen`、`Delay`），回调属于整棵树，条件可能被反复求值，每次都会多注册一次；或者运行的树到运行时才加载（`RunTree`），那棵树里的节点没有和这棵树一起检查，可能含有前一种节点。要复用条件逻辑，在编辑器里用子树，导出时会内联进来，和条件树一起检查。这一条运行时在**加载时**检查：条件树里（包括嵌套在条件树里的条件树）出现这种节点就抛异常，被禁用的节点不检查。编辑器同样根据这个标记校验。

**运行时：检查返回值**

| 条件树的结果 | 处理 |
|---|---|
| `success` | 条件为 true |
| `failure` | 条件为 false |
| `running` | 报错（带上树名和节点 id），中止条件树，条件为 false |
| `error` | 条件为 false（4.3 节） |
| 抛异常 | 和普通节点一样，派发 `TreeEvent.EXCEPTION` 并中断整棵树（3.4 节） |

**条件树的作用域**

条件树在一个隐式的作用域里执行（[scope-design.md](scope-design.md) 第 4 节）：能读到外层的变量，写黑板的节点（Let、Calculate、Now 等）的写入只留在这次求值里，求值结束就丢掉。所以先取数据再判断（比如 `GetHp` 再 `Cmp`）是正常写法，不会影响主树。

- 要把条件树里算出来的变量交给主树，用 `Scope` 当条件树的根节点，在它的 output 里声明，条件为 true 时导出（scope-design.md 第 7 节）。
- Once 的状态是节点的私有变量，始终在根黑板，放在条件树里也只执行一次。
- Delay、Listen 的回调在那次求值的作用域里执行（闭包语义）。

隔离的只是变量绑定。修改对象内容的节点（SetField、Push）和宿主的副作用不做限制，约定**条件树里只放判断逻辑**。编辑器不对 `type` 为 Action 或声明了 `output` 的节点报错或警告。

### 4.5 抢占的实现

`Node` 构造时解析 `cfg.conditions`，为每一项创建条件树，并筛出 self/both 的项。preemptive 的父节点在构造时记下哪些子节点带 lower/both 的条件：

```ts
interface Condition {
    readonly root: Node;            // 由 ConditionData.root 创建的条件树
    readonly abort: AbortMode;
}

abstract class Node {
    readonly conditions: readonly Condition[];

    get abortsLower(): boolean;     // 有 lower/both 的项
    get abortsSelf(): boolean;      // 有 self/both 的项

    evalConditions(tree): boolean;      // 进入和抢占时使用：全部项 AND，短路
    evalSelfConditions(tree): boolean;  // 重入时使用：只检查 self/both 的项

    /** 返回左侧第一个能抢占的子节点下标，没有则返回 running */
    protected _checkPreempt(tree, running: number): number;
}

class Selector extends Node {
    onTick(tree) {
        let i = tree.getState<number>(this);
        let checked = false;
        if (i === undefined) {
            i = 0;
        } else {
            const k = this._checkPreempt(tree, i);
            if (k !== i) {
                this.children[i].abort(tree);
                i = k;
                checked = true;
            }
        }
        for (; i < this.children.length; i++) {
            const status = this.children[i].tick(tree, checked);
            checked = false;
            // ……正常的 Selector 逻辑
        }
    }
}
```

- 没有子节点带 lower/both 时（大多数情况），重入几乎没有额外开销。
- 抢占成功后，父节点用 `tick(tree, true)` 进入子节点 i，跳过进入检查：它的条件刚在 `_checkPreempt` 里全部求值过。这样每个节点的条件每帧最多求值一次，带随机性的条件也不会出现"抢占时为 true、进入时为 false"。

### 4.6 `preemptive` 标记

```ts
interface NodeDef {
    /** 组合节点是否用左右顺序表达优先级，并且实现了抢占检查 */
    preemptive?: boolean;
}
```

| 组合节点 | 子节点的含义 | lower 有没有意义 |
|---|---|---|
| Selector | 按优先级从左到右尝试 | 有 |
| Sequence | 按步骤依次执行 | 没有。子节点 j 在运行，说明 i 已经成功过了，"抢占回 i"等于重启 |
| Parallel / Race | 同时运行 | 没有 |
| IfElse / Switch | 按条件选分支 | 没有 |

- 内置节点里只有 `Selector` 标记了 `preemptive`，和 UE 一样，Sequence 不支持 Lower Priority。
- 自定义的组合节点（比如 `WeightedSelector`）可以声明这个标记，并调用 `_checkPreempt` 实现检查（第 7 节）。
- 加载时的 warning：子节点配置了 `lower`/`both` 但父节点不是 preemptive；根节点的条件配置了 `lower`/`both`。abort 取值不合法时抛异常。

### 4.7 和 UE 的区别

| | UE | behavior3-ts |
|---|---|---|
| 触发方式 | 事件驱动：装饰器订阅黑板变化，主动发起 `RequestExecution` | 轮询：每帧重入时，由 preemptive 父节点检查 |
| 判断优先级 | 比较节点的执行索引（`FBTNodeIndex`） | 比较子节点下标 i < j |
| 打断之后 | 中止任务（可以延迟中止），从父组合节点重新搜索 | 立即 abort 子节点 j，从子节点 i 开始执行 |

UE 的行为树不会每帧从根节点重入，所以用事件驱动。这里每帧重入，轮询更简单；条件求值的开销可以在条件节点里缓存（依赖的数据不变就不重新计算）来降低。

## 5. 参数语义

| 参数类型 | 语义 | 实现 |
|---|---|---|
| `json`、`json?`、`json[]`、`json[]?`，以及 descriptor 里没声明的参数 | **字面量**：每次 tick 都生成新副本，归本次执行所有，可以修改，也可以交出去 | 缓存 JSON 字符串，每次 tick 调用 `JSON.parse` |
| 其他对象参数（`int[]`、`string[]`、`expr[]` 等） | **只读配置**：所有树、所有次执行共享 | 构造时解析一次并 deep freeze，修改时抛异常 |

- 判断规则：**这个值会被修改或者交出去吗？会，就声明成 `json`。**
- 来自 input 的值是**黑板对象的引用**，不是副本，修改它就是修改黑板。
- `json` 副本的生命周期是**一次 tick**。running 的节点如果需要跨帧保留修改，自己存进 `setState`。
- 在 TS 声明里体现可变性：

```ts
class Let extends Node {
    declare args: { value?: unknown };                    // json：可变，归本次执行所有
}

class RandomPick extends Node {
    declare args: { readonly list: readonly number[] };   // int[]：只读配置
}
```

- 参数可以和 input 二选一（NodeDef 里 arg 的 `oneof`）：配置了 input 就用黑板上的值，否则用参数。用 `_checkOneof(inputIndex, argValue, defaultValue?)` 读取：input 不存在时，有默认值就打印 warning 并使用默认值，没有就返回 `ERROR`。

## 6. 内置节点

各节点的完整说明在 NodeDef 的 `doc` 里，编辑器会显示。这里只列出需要特别说明的行为。

**组合节点**

- **Parallel**：参数 `successCount`（默认全部子节点）。每次执行所有还没结束的子节点，已经结束的不再执行。
  - 成功的子节点达到 `successCount`（≥）时立即返回 success；
  - 失败的子节点多到不可能达到时（失败数 > 子节点数 − `successCount`）立即返回 failure；
  - 有子节点返回 error 时立即返回 error；
  - 返回时中止还在运行的子节点。

  所以默认是"全部成功才成功，任何一个失败就失败"，`successCount` 为 1 时和 Race 一样。不需要关心某个子节点的成败时，给它包一层 AlwaysSuccess（连 error 也要忽略时，再在里面包一层 ErrorToFailure）。`successCount` 不是 [1, 子节点数] 之间的整数时，加载时抛异常。
- **Race**：有子节点成功时立即返回 success，全部失败时返回 failure，返回时中止其他还在运行的子节点。
- **Switch / Case**：Case 只是把判断节点和执行节点组织在一起的虚拟节点，不会被执行，Switch 直接执行 Case 的两个子节点。所以 Switch 在 `onAbort` 里中止正在运行的那个孙节点；挂在 Case 上的条件不会生效，加载时给出 warning。Case 的判断节点可以跨帧运行、可以有副作用和输出，所以不能用条件替代。

**装饰节点**

- **AlwaysSuccess / AlwaysFailure**：子节点返回 success 或 failure 时，返回 success / failure；返回 running 和 error 时原样返回。error 表示数据不可信，不会被当成成功或失败吞掉，需要忽略 error 时先包一层 ErrorToFailure（比如 `AlwaysSuccess → ErrorToFailure → 子节点`）。
- **ErrorToFailure**：子节点返回 error 时返回 failure，其他结果原样返回。不处理异常。
- **Once**：第一次执行完子节点后返回 success，之后一直返回 failure。子节点返回 error 时不算执行过，下次还会执行。
- **RetryUntilSuccess / RetryUntilFailure**：子节点立即完成时，下一帧再重试；子节点 running 之后才完成时，同一帧立即重试。
- **ForEach / Filter**：output 用来把循环变量传给子节点，节点结束时框架把 output 写回黑板，循环变量随之被清掉，不会留在循环外面。running 后恢复执行时，从上次的元素继续。
- **Listen / Delay**：执行时注册监听或定时器，立即返回 success。回调里的子节点通过 `__tickInCallback` 执行（3.5 节）。
  - Listen 每次执行都会注册一次监听，通常要包在 `Once` 下面使用。
  - **注册属于整棵树，不属于分支**：它们执行完就结束了，不会处于 running，所以中止、抢占、`interrupt()` 都不影响已注册的监听和定时器，只有 `tree.clear()` 会移除。比如战斗分支里注册的受击监听，分支被抢占后仍然有效。
  - 需要跟着分支走的等待，用 `WaitForEvent`：它一直 running，被中止时注销监听。
  - 回调在注册时所在的作用域里执行，即使那个 `Scope` 已经结束（闭包语义，[scope-design.md](scope-design.md) 第 8 节）。
  - 树被中断、清理的过程中触发的回调跳过：Listen 不写 output、不执行子节点（监听树自己的事件除外，2.6 节）。
- **Scope**：子节点在独立的作用域中执行，能读外层变量，写入只留在作用域里；output 列出的变量只在成功时写回外层，变量名内外相同。作为条件树的根节点时，条件为 true 才导出。详见 [scope-design.md](scope-design.md)。

**行为节点和条件节点**

- **WaitForEvent**：用状态加 `onAbort` 移除监听。移除时用 `on` 返回的取消函数，只移除自己的那一个，不影响同一棵树在同一事件上的其他监听（`Listen`、其他 `WaitForEvent`）。
- **RunTree**：在独立的 `Tree` 实例中执行另一棵树，子树看不到调用方的变量。input 在开始执行时按值传给子树，output 只在成功时从子树导出到调用方的当前作用域。同一个单位上，同一个节点对同一个路径复用一个实例，`clear` 时一起清掉；`keep` 设为 `false` 时每次执行都从干净的子树开始，执行结束就清理，每个节点最多留一个实例，适合路径种类多的情况。树还没加载时返回 running，`timeout` 只限制加载，加载失败时返回 error；子树的异常转成 error。声明了 `deferred`，不能放进条件树（4.4 节）。详见 [run-tree-design.md](run-tree-design.md)。
- **Check、Calculate**：表达式支持算术、比较、逻辑、位运算、三元表达式、多层属性访问（`a.b.c`）、下标（`arr[i + 1]`）和字符串。只写一个变量名（比如 Check 的 `isDead`）时返回变量的值。引用不存在的变量时返回 error，判断变量是否存在用 IsNull/NotNull。表达式在加载时编译，编译不过时抛异常；`context.registerCode` 可以为表达式注册预先生成的函数，跳过解析。
- 数据不对时返回 error 的情况见 3.3 节。

## 7. 自定义节点

```ts
@registerNode                        // 注册到全局，创建 Context 时自动注册；也可以用 context.registerNode(MyNode)
export class MyNode extends Node {
    declare input: [number];
    declare args: { readonly range: number };

    override onTick(tree: Tree<Context, unknown>): Status { ... }
    override onAbort(tree: Tree<Context, unknown>): void { ... }

    static override get descriptor(): NodeDef {
        return {
            name: "MyNode",
            type: "Action",
            group: ["Example"],
            desc: "……",
            status: ["success", "failure"],
        };
    }
}
```

- 只实现 `onTick`、`onAbort` 和 `onClear`。重写 `tick` 或 `abort` 时加载抛异常。
- `onClear` 在 `tree.clear()` 时对每个节点（包括条件树里的）调用一次：在 running 的节点 `onAbort` 之后、清空黑板之前，用来释放节点为这棵树保留的东西（比如私有变量里缓存的子树实例）。
- `tree.clear()` 可以在执行中调用（比如节点把单位打死，宿主销毁单位）：它只标记停止，执行栈一路返回 `running` 退出，栈上的节点不会拿着已清空的状态继续执行。`tick`、`__tickInCallback`、`bindCallback` 绑定的回调，以及 `interrupt()`、`clear()` 的过程都算执行（2.6 节）（`onAbort` 里调用 `clear` 时，等所有 running 的节点都中止完才清理），等最外层的那个退出后（绑定的回调剩下的代码也执行完，比如 `Delay` 恢复暂存变量），在同一个调用栈里从根黑板按 `CLEANED` → `INTERRUPTED` → `onAbort` → `onClear` → 清空状态、黑板和监听的顺序完成清理。树空闲时在回调里调用，同样会停下这个回调。`CLEANED` 的监听、`onAbort`、`onClear` 里再调用 `clear` 会被忽略，调用 `tick` 会抛异常。
- `onTick` 里的 `tree.blackboard` 是当前作用域，在 `Scope` 或条件树里是它的覆盖层（[scope-design.md](scope-design.md) 第 10 节）。
- 节点注册的回调在节点返回之后才执行、属于整棵树时（像 `Listen`、`Delay`），或者运行的树到运行时才加载时（像 `RunTree`），在 NodeDef 里声明 `deferred: true`，放进条件树时加载报错。返回 `running` 等待的节点（像 `Wait`、`WaitForEvent`）不算：它们的状态由框架管理，被中止时会清理。
- 注册监听或定时器时，回调用 `tree.bindCallback(fn)` 包一层，触发时回到注册时的作用域；不包的回调在 tick 之外执行时用的是根黑板，放在 `Scope` 里会写到外面。
- `bindCallback` 只绑定同步执行的那一段：回调可以在任意时刻触发，但触发后要同步执行完。`fn` 是 async 函数时编译报错，运行时返回 Promise 会抛异常，因为 `await` 之后的代码已经不在绑定的作用域里了。异步任务在外面完成，完成时再调用绑定好的同步回调：`task.then(tree.bindCallback((result) => { ... }))`。
- 树被 `clear()` 之后，之前绑定的回调触发时什么都不做，返回 `undefined`。`offAll` 能移除 context 上的监听和定时器，Promise 这类移除不了的回调靠这条规则，不会在清理过的树上执行。
- 跨帧的状态用 `tree.setState`，不要存在节点实例上：节点实例被所有单位共享。
- 一次调用里的临时数据用局部变量，不要存在节点实例的字段上。节点可能在执行中被重入：递归的 `RunTree`，或者执行中同步 tick 了同一路径的另一棵树（宿主同步派发事件、直接调用 `tick`）。框架在重入时保存并恢复 `input`、`output` 和 `json` 参数，节点自己的字段保护不了。
- 返回 running 时启动了需要清理的东西（移动、监听、定时器），在 `onAbort` 里清理。监听用 `context.on` 返回的取消函数移除，它只移除这一个；`off(event, tree)` 会移除整棵树在这个事件上的所有监听，只适合整体清理。
- **组合节点和装饰节点收到子节点的 `"error"` 时，要返回 `"error"`**（ErrorToFailure 这类专门处理 error 的节点除外）。框架不会替节点传递 error。
- 数据不可信时返回 `"error"` 并打印 warning；代码 bug 用 `this.throw(msg)` 或直接抛异常。
- `_checkOneof` 返回 `ERROR` 时，返回 `"error"`。
- 声明了 `preemptive` 的组合节点，在重入 running 的子节点之前调用 `_checkPreempt`。
- 会放进条件树的节点要声明 `status`，编辑器才能检查（4.4 节）。
- 修改或交出去的参数声明成 `json`（第 5 节）。

## 8. 黑板与 Context

- **黑板**：`get`、`set`（设成 `undefined` 或 `null` 时删除）、`eval(code)`。私有变量和临时变量的说明见 2.2 节。
  - `tree.blackboard` 是当前作用域：tick 之外是根黑板；`Scope` 和条件树会 fork 一个覆盖层，读取沿原型链读到外层，写入只留在覆盖层，覆盖层里设成 `undefined` 会遮住外层的变量。私有变量和临时变量始终在根黑板。详见 [scope-design.md](scope-design.md)。
- **Context**：所有树共享，提供节点注册、树的加载和缓存（`loadTree` 由使用方实现；Promise 被 reject 时，`Tree` 记下 `loadError`，`tick()` 返回 `error`，需要重试在 `loadTree` 里实现）、时间（`time`、`update(dt)`）、定时器（`delay`）、事件（`on`、`off`、`offAll`、`dispatch`）、表达式编译（`compileCode`、`registerCode`）。`on` 和 `delay` 返回取消函数，只移除这一个监听或定时器；`off`、`offAll` 按标签批量移除。`dispatch` 只调用派发开始时已经注册的监听：派发过程中新注册的从下一次派发开始调用，移除的不再调用，同一个回调重新注册（替换）时保留原来的位置，这次照常调用一次。`update` 过程中新安排的定时器最早在下一次 `update` 触发，即使延迟是 0（负的延迟按 0 算），回调每次重新安排自己也不会在一次 `update` 里死循环。
- 每个节点都要声明 `group`。`supportGroupTypes` 决定 Context 构造时注册哪些用 `registerNode` 注册的节点：Context 支持节点的某一个 group 才会注册。默认是 `["Core"]`，内置节点都属于 `Core` 分组；重写 `supportGroupTypes` 时要带上 `Core`，否则内置节点不会注册。`context.registerNode` 直接注册的节点不受 `supportGroupTypes` 限制。

## 9. 编辑器

编辑器需要支持以下功能，运行时才能用上条件：

- **数据**：读写 `conditions`（条件树按普通节点递归解析，id/uuid 分配包括条件树里的节点）；保留 NodeDef 的 `preemptive`；导出时带上条件，包括条件树里引用的子树；升级文档版本 `DOCUMENT_VERSION`。
- **展示**：条件以徽标的形式显示在节点顶部，标出条件项的 abort 模式和条件树根节点的名称；可以展开或折叠，或者像子树那样在独立视图里编辑。一个节点可以挂多项条件：每项一块，按数组顺序从上到下叠在节点上方，选中某一块编辑这一项；用右键菜单或快捷键上移、下移调整顺序（顺序就是求值顺序）。
- **校验**：
  - 每个条件项必须有 `root`；`abort` 只出现在条件项上；
  - 条件树里不能有声明了 `deferred` 的节点（4.4 节），有就报错；
  - 条件树不能返回 running：按 `status` 递归推导（4.4 节），不通过就报错；没有声明 `status` 的节点不检查。条件树里可以有 Action 类节点和声明了 `output` 的节点（比如先取数据再判断），不报错也不警告；
  - 父节点不是 preemptive 时，禁用 `lower` 和 `both`，已有的值标红，构建报错；
  - 树的根节点不能挂条件。子树的根节点同样不挂，条件挂在引用它的节点上，因为只有在引用处才知道父节点；子树展开时，根节点使用引用处的条件；
  - id 树内唯一（包括条件树里的节点，编号规则见 4.2 节）。
- **提示**：选中一个条件时，高亮它能影响的范围。`self` 高亮自己的子树，`lower` 高亮右侧兄弟节点的子树。
- **`.b3-setting`**：导出 `preemptive` 和 `deferred`。`status` 本来就会导出，条件树的检查直接使用它。
- **`Scope` 和 `RunTree`**：都是普通节点，通过 `.b3-setting` 读取，不需要特殊支持。可选：`Scope` 导出的变量在子树里没有任何节点输出时给出警告。
- **文档版本**：树文件的 `version` 是编辑器的文档格式版本，运行时不检查。旧版编辑器打开带 `conditions` 的文件时给出提示。

## 10. 性能

- 每帧执行 running 路径上的所有节点，调用次数等于树的深度。
- `json` 以外的对象参数在构造时解析一次；状态用数组下标存储并保持紧凑；`Node.tick` 的热路径不创建闭包；没有子节点带 lower/both 时不做抢占检查。
- Context 按标签索引监听和定时器，`offAll` 只遍历这个标签自己的；定时器放在通用的优先队列 `PriorityQueue`（二叉堆，`priority-queue.ts`，库里导出，宿主可以复用）里，按到期时间和注册顺序排序（同一时刻到期的按注册顺序执行），注册和取出是 O(log n)，取消只做标记，弹出时跳过，已取消的超过一半时整理一次。
- 基准测试：`npm run bench`（`test/bench.ts`），不在 `npm test` 里，改运行时前后手动对比。每个场景 1000 个单位共享一棵树（和游戏里一样只有一份节点图），各 tick 1000 次，输出耗时、GC 次数和耗时、堆用量的变化：
  - `deep`：8 层、running 路径上有 Parallel 和 Timeout，只测沿 running 路径往下走（进入 running 后组合节点直接接着执行 running 的子节点，表达式不再求值）；
  - `preempt`：带 self/both 条件、敌人周期性出现和离开的抢占场景；
  - `eval`：每帧从头执行完，每帧求值 Check/Calculate 表达式；
  - `scope`、`runtree`、`callback`：每帧进入 `Scope`、通过 `RunTree` 执行小子树、派发事件触发 `Listen` 的回调；
  - `context`：1000／4000／16000 个单位各自注册监听和定时器，测注册并触发定时器、逐个 `offAll` 清理的耗时。
  - 参考值（Apple M5，Node 26）：deep 约 810 ns/tick（没有 GC），preempt 约 590，eval 约 980，scope 约 580，runtree、callback 约 320；context 16000 个单位注册并触发约 15 ms，清理约 12 ms。

## 11. 测试

- `npm test` 运行 `test/unit` 下的单元测试（node:test），覆盖执行模型、状态接口、每个内置节点、中止与中断、error 的传递（`error.test.ts`）、异常（包括异步回调和嵌套回调）、条件与抢占、表达式求值、黑板、作用域（`scope.test.ts`，条件树的作用域在 `conditions.test.ts`）、RunTree 和 `onClear`（`run-tree.test.ts`）、生命周期规则表和不变量（`lifecycle.test.ts`）、Context 的定时器和事件、节点注册，以及多个节点组合的场景。
- `npm run bench` 运行基准测试（第 10 节）。
- `npm start` 运行 `test/main.ts`，用 `example/*.json` 跑一遍，并重新生成 `example/node-config.b3-setting`。

## 12. 与 1.x 的区别

**执行模型**

- 1.x 把 running 的节点保存在 `tree.stack` 里，每帧从栈顶继续执行，祖先节点不会被执行到；2.0 每帧从根节点执行（2.1 节）。删除了 `Stack`、`StackSlice`、`tree.stack`。
- `onTick(tree, status)` 改为 `onTick(tree)`；自定义的组合节点和装饰节点需要按"调用 `child.tick()`、拿返回值"的方式重写。
- `tree.yield` / `tree.resume` 改为 `getState` / `setState` / `isRunning`。被中止的节点状态会被清除，Wait 等节点不会拿到上一次的到期时间。

**状态与错误**

- `error` 由父节点逐层传递，不当成 failure（第 3 节），新增 `ErrorToFailure`。依靠 error 表达"目标不存在就走下一个分支"的树（比如 GetField 的对象不存在），要包一层 `ErrorToFailure`，或者在前面加 NotNull 判断。
- 执行时数据不对一律返回 error（3.3 节）。1.x 里 Math 参数个数不对、最小值大于最大值时打日志并返回 failure。
- 节点抛异常时中断整棵树：新增 `TreeEvent.EXCEPTION`，`TreeStatus` 新增 `"exception"`。

**节点和参数**

- 树文件新增 `conditions` 字段（第 4 节）。
- 删除 Watchdog 节点：每帧检查条件改用 `abort: self` 的条件，被打断时的清理放进节点的 `onAbort`。
- Parallel 新增 `successCount`，默认全部子节点成功才返回 success，任何一个失败就返回 failure；1.x 的 Parallel 在子节点全部结束后总是返回 success。
- `json` 以外的对象参数只读，修改时抛异常（参数被 deep freeze，ES module 是严格模式）。
- Filter 恢复执行时从上次的元素继续，1.x 会从第 0 个重新开始。
- 表达式：只写一个变量名时返回变量的值，1.x 返回变量名字符串（永远为真）；修复了三元表达式取错分支、`&&`/`||` 两边是布尔变量时报错、`^`/`~` 无法解析、多层属性访问和字符串属性出错、下标里带运算解析错误等问题。
- 在 2.0 的执行模型下，每帧执行的节点数大约是 1.x 的两倍；一棵不含表达式的 8 层树，1.x 约 540ms，2.0 约 580ms。
