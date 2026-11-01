# behavior3-ts 2.0 设计

> 状态：运行时已按本文实现，编辑器尚未支持。打断与抢占的逐帧例子和使用建议见 [abort-mechanism.md](abort-mechanism.md)。

## 1. 概述

2.0 的核心是**参考 UE（Unreal Engine）行为树的装饰器打断（Observer Aborts）实现条件打断**：节点上可以挂条件，条件按 `none` / `self` / `lower` / `both` 四种模式，在节点运行期间打断自己，或者让高优先级的分支抢占正在运行的低优先级分支。

为了让挂在祖先节点上的条件每帧都能被重新判断，执行模型从"基于栈恢复"改为**每帧从根节点重入**，框架也因此简化。同时整理了中止、错误处理和参数语义。

存在不兼容改动，版本号升到 **2.0**（见第 9 节）。

## 2. 执行模型

### 2.1 每帧从根节点重入

1.x 把 running 的节点保存在 `tree.stack` 里，每帧从栈顶继续执行，**祖先节点不会被执行到**，挂在祖先上的条件没有机会重新判断。`Parallel`、`Race`、`Timeout` 为了每帧都能执行，只能把子栈搬进 `StackSlice` 自己维护，逻辑复杂。

2.0 每帧调用 `root.tick()`，沿着 running 路径一路走到正在运行的节点，父节点直接拿到 `child.tick()` 的返回值。`Stack`、`StackSlice`、`tree.yield`/`tree.resume`、`onTick` 的 `status` 参数，以及各节点里的搬栈代码都删除了。

```ts
// Sequence 示意
onTick(tree) {
    let i = tree.getState<number>(this) ?? 0;   // 从上次 running 的子节点继续
    for (; i < children.length; i++) {
        const status = children[i].tick(tree);
        if (status === "running") {
            tree.setState(this, i);
            return "running";
        } else if (status === "failure") {
            return "failure";
        }
    }
    return "success";
}
```

`Node.tick` 不允许重写，它负责条件检查、读写 input/output、调用 `onTick`、捕获异常和维护状态；节点只实现 `onTick`。`node.tick()` 只能由父节点或框架调用，外部一律用 `tree.tick()`：节点出错时要靠 `tree.tick()`（或回调）把这一次执行退出来，绕开 Tree 直接调用时出错只会得到 `failure`。

### 2.2 节点状态

同一个树文件对应的 Node 实例被所有单位共享（`context.trees[path]`），所以每个单位的运行状态存在 Tree 上：

```ts
tree.getState<T>(node): T | undefined
tree.setState(node, value)      // 返回 running 时设置，节点结束或被中止时由框架清除
tree.isRunning(node)
```

- 构建树时给每个节点（包括条件树里的节点）分配连续的 `index`，状态存在 Tree 的数组里，按下标读写。数组保持紧凑，不留空洞，稀疏数组在 V8 里明显更慢。
- 节点返回 running 但没有设置状态时，框架记一个内部标记：`isRunning` 为 true，`getState` 返回 `undefined`。
- 黑板只用来放业务变量。需要跨越多次执行的持久状态（比如 `Once` 的"已执行"标记）存在黑板的私有变量里，中断不会清除它，`tree.clear()` 才会。

### 2.3 中止（abort）

```ts
abort(tree): void        // 递归：先中止 running 的子孙，再调用 onAbort，最后清除状态；不允许重写
onAbort(tree): void      // 节点自己清理：停止移动、移除监听和定时器等
```

- **显式中止**：组合节点切换分支、或者自己被中止时，主动调用 `child.abort(tree)`，保证旧分支先清理完、新分支才开始。
- **兜底**：节点返回非 running 时，框架对它仍在 running 的子节点调用 `abort()`。所以 Race 一个子节点成功、Timeout 超时时，其他还在运行的分支都会被清理。
- 被中止的节点状态被清除，下次执行从头开始。1.x 的 `StackSlice.clear()` 只截断数组，`Wait` 下次执行时会拿到上一次的到期时间，这个问题随之修复。
- `onAbort` 里的异常只打日志，不影响中止流程。
- **debug 模式下检查漏掉的中止**：兜底只能覆盖"节点结束"的情况。组合节点自己一直 running、中途换了分支却没有中止旧分支时，旧分支的状态会残留，下次进入会从残留状态继续执行。`tree.debug` 开启时，每次 tick 结束检查"仍在 running、但这一帧没有被执行到"的节点，打印 warning。故意不每帧执行 running 子节点的自定义节点（比如节流）会被误报。

### 2.4 中断（interrupt）

`tree.interrupt()` 中止整棵树：

- 在 tick 过程中调用时，`Node.tick` 一进入就直接返回 running，这一帧不再执行任何节点（包括 Parallel 后面的兄弟节点）。帧结束时遍历整棵树（包括条件树），对所有有状态的节点调用 `onAbort`，清空状态和临时变量，派发 `TreeEvent.INTERRUPTED`，`tree.tick()` 返回 `"interrupted"`。
- 不在 tick 过程中调用时立即执行上述清理；树没有在运行时什么都不做。
- 下一帧从根节点重新开始。

### 2.5 错误处理

节点状态只有 `success`、`failure`、`running`，**没有 `error`**：

- **failure 只表示正常的否定结果**：没有敌人、数组里不包含这个值等，父节点据此选分支。
- **数据或配置错了就抛异常**：输入类型不对、计算结果是 NaN、缺少必需的输入等，用 `node.throw(msg)`。

1.x 的 `error` 在大多数父节点里被当成 failure：Selector 会接着试下一个分支，AlwaysSuccess 会吞掉，条件树当成 false。结果是数据错了，逻辑却走进了另一个分支。要让 `error` 真正起作用，每个组合节点和装饰节点（包括用户自定义的）都得特别处理它，等于手写一遍异常传递，漏一个就退化成 failure。

**`tree.tick()` 里的异常**

1. 抛异常的节点在自己的 `Node.tick` 里捕获，打印带树名、节点 id 和调用栈的错误日志。
2. 派发 `TreeEvent.ERROR`，参数是 `(error: Error, node: Node)`，抛出的不是 `Error` 时包装成 `Error`。游戏可以在这里统一上报、禁用这棵树等。Listen 不提供这个事件：错误由游戏代码处理，树不处理自己的 bug（也避免 Listen 的子节点出错后再次触发 ERROR 形成死循环）。
3. 中断整棵树（2.4 节），父节点拿到的是 running，不会误判。
4. `tree.tick()` 返回 `"error"`，`tree.status` 也是 `"error"`，表示**这一次 tick 有节点出错**，和主动中断的 `"interrupted"` 区分开；同一帧里两者都有时以 `"error"` 为准。下一帧从根节点重新开始，返回正常的结果。

**异步回调里的异常**

`Listen`、`Delay` 在事件或定时器回调里执行子节点，这和 `tree.tick()` 无关，所以回调里出错**不影响主树**：不中断，`tree.status` 不变，主树正在 running 的分支继续执行。

- 回调通过内部方法 `tree.__tickInCallback(node)` 执行子树，相当于一次只针对这棵子树的独立执行。
- 出错时同样打印日志、派发 `TreeEvent.ERROR`，然后只停下这棵子树：这次回调里不再执行任何节点。
- 子树执行完后，中止其中所有 running 的节点（回调里的子树不能跨帧运行）。
- 事件在主树 tick 过程中同步派发时，也按回调处理，不影响这一次 tick。
- 回调里的节点主动调用 `tree.interrupt()` 仍然中断整棵树，回调结束后生效（在 tick 过程中则在这一帧结束时生效）。

**加载时的异常**（节点重写了 `tick` 或 `abort`、abort 取值不合法、子节点数量不够等）不捕获，直接抛给加载树的调用方。

## 3. 条件与打断（参考 UE）

### 3.1 和 UE 的对应关系

| UE | behavior3-ts |
|---|---|
| 挂在节点上的条件装饰器（Decorator） | 节点的 `conditions` 数组中的一项 |
| 装饰器的判断逻辑 | 条件树 `root`：一棵普通的行为树，只返回 success 或 failure |
| Observer Aborts：None / Self / Lower Priority / Both | `abort`：`none` / `self` / `lower` / `both` |
| `UBTCompositeNode::CanAbortLowerPriority()`（Selector 支持，Sequence 不支持） | NodeDef 的 `preemptive` 标记（内置只有 Selector） |
| Lower Priority 的作用范围：同一个组合节点下、优先级更低的分支 | 同一个父节点下、右侧的兄弟分支 |
| 打断后中止正在运行的任务，从被装饰的分支开始执行 | abort 正在运行的子节点 j，从子节点 i 开始执行 |

语义上和 UE 保持一致，实现方式的差异见 3.7 节。

### 3.2 树文件格式

```jsonc
{
  "id": 3,
  "name": "Sequence",
  "conditions": [                  // 条件数组，项与项之间是 AND
    {
      "abort": "both",             // none | self | lower | both，默认 none；作用于整棵条件树
      "root": {                    // 条件树的根节点，和普通节点的数据格式完全一样
        "id": 4,
        "name": "Selector",
        "children": [
          { "id": 5, "name": "Check", "args": { "value": "hp < 20" } },
          { "id": 6, "name": "Sequence", "children": [
              { "id": 7, "name": "IsStatus", "args": { "status": "stunned" } },
              { "id": 8, "name": "Invert", "children": [ { "id": 9, "name": "HasShield" } ] }
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
- **abort 写在条件项上，不写在节点上**，作用于整棵条件树。这样条件树里的节点和普通节点格式一致，编辑器和运行时都可以直接复用现有的节点解析；一棵带 OR 的树也没法只判断其中一部分，所以不给树内部的节点单独配置 abort。
- **运行时完整支持多项**，类似 UE 在一个节点上挂多个装饰器。编辑器可以先限制为 1 项，以后放开时运行时和已有的树文件都不用改。
- 可以通过 Subtree 引用条件文件，比如 `cond/can-attack.json`，在多个节点之间复用。
- 条件树里节点的 id 和普通节点共用一个编号序列，树内唯一，由编辑器分配。
- 条件树内部不允许再挂条件。

### 3.3 语义

设节点 `N` 挂了条件 `C1, C2, ..., Cn`，每一项有自己的 abort 模式；`N` 是组合节点 `P` 的第 i 个子节点。

| 时机 | 检查哪些项 | 结果 |
|---|---|---|
| **进入** `N`（N 不在 running） | **全部**项 | 有任何一项为 false：不进入，返回 failure |
| **重入** `N`（N 正在 running） | 只检查 abort 为 `self` 或 `both` 的项 | 有任何一项为 false：abort `N` 的子树，返回 failure |
| `P` 准备重入正在 running 的子节点 j（j > i）之前，并且 `P` 是 preemptive | 至少有一项是 `lower` 或 `both` 时才判断；判断时检查**全部**项 | 全部为 true：abort 子节点 j，从子节点 i 开始执行 |

- 各项按数组顺序求值，遇到第一个 false 就停止（短路）。
- 抢占时检查**全部**项，标准和"进入"一致。`lower` 只决定"要不要去判断"，真正能不能抢占要看全部条件。这样可以避免"抢占成功、一进去就失败"：比如 `[HasEnemy(lower), HpAbove50(none)]`，只有发现敌人并且血量足够时才会打断巡逻。
- abort 为 `none` 的项只在进入时判断（以及作为抢占时的附加条件），效果等同于放一个前置 Condition 子节点，好处是树更扁。

例子：

```jsonc
"conditions": [
  { "abort": "both", "root": { "id": 4, "name": "HasEnemy" } },     // A
  { "abort": "self", "root": { "id": 5, "name": "HpAbove50" } },    // B
  { "abort": "none", "root": { "id": 6, "name": "NotStunned" } }    // C
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

### 3.4 条件树的约束

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
    if (!status) return true;                       // 没声明 status：按"可能 running"处理
    if (status.includes("running")) return true;
    if (status.includes("|running")) return cfg.children.some((c) => !c.disabled && canRun(c, defs));
    return false;
}
```

自定义节点没声明 `status` 时，编辑器给出 warning，由运行时的返回值检查保证。所以**自定义的条件节点应该声明 `status`**。

**运行时：检查返回值**

| 条件树的结果 | 处理 |
|---|---|
| `success` | 条件为 true |
| `failure` | 条件为 false |
| `running` | 报错（带上树名和节点 id），中止条件树，条件为 false |
| 抛异常 | 和普通节点一样，派发 `TreeEvent.ERROR` 并中断整棵树（2.5 节） |

**副作用靠约定**

`status` 看不出节点有没有副作用。有些节点不会返回 running，但不适合放进条件树：

- 写黑板或修改对象的 Action：Let、SetField、Push、Calculate、Now 等；
- 注册回调或定时器：Delay、Listen；
- 有持久状态：Once（执行一次就会被"用掉"）。

这一类不做强制限制，约定**条件树里只放判断逻辑**。编辑器可以给出 warning：`type` 为 Action 的节点，或者声明了 `output` 的节点。

### 3.5 抢占的实现

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

### 3.6 `preemptive` 标记

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
- 用户自定义的组合节点（比如 `WeightedSelector`）由作者决定是否声明这个标记，并调用 `_checkPreempt` 实现检查。
- 加载时的 warning：子节点配置了 `lower`/`both` 但父节点不是 preemptive；根节点的条件配置了 `lower`/`both`。abort 取值不合法时抛错。

### 3.7 和 UE 的区别

| | UE | behavior3-ts |
|---|---|---|
| 触发方式 | 事件驱动：装饰器订阅黑板变化，主动发起 `RequestExecution` | 轮询：每帧重入时，由 preemptive 父节点检查 |
| 判断优先级 | 比较节点的执行索引（`FBTNodeIndex`） | 比较子节点下标 i < j |
| 打断之后 | 中止任务（可以延迟中止），从父组合节点重新搜索 | 立即 abort 子节点 j，从子节点 i 开始执行 |

UE 用事件驱动，是因为它的行为树不会每帧从根节点重入。本方案每帧重入，轮询更简单。以后如果有性能需要，可以加"依赖的 key 不变就不重新判断"的缓存，相当于把事件驱动当作一种优化补上。

## 4. 参数语义

| 参数类型 | 语义 | 实现 |
|---|---|---|
| `json`、`json?`、`json[]`、`json[]?`，以及 descriptor 里没声明的参数 | **字面量**：每次 tick 都生成新副本，归本次执行所有，可以修改，也可以交出去 | 缓存 JSON 字符串，每次 tick 调用 `JSON.parse` |
| 其他对象参数（`int[]`、`string[]`、`expr[]` 等） | **只读配置**：所有树、所有次执行共享 | 构造时解析一次并 deep freeze |

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

## 5. 内置节点说明

- **Switch / Case**：Case 只是把判断节点和执行节点组织在一起的虚拟节点，不会被执行，Switch 直接执行 Case 的两个子节点。所以 Switch 在 `onAbort` 里中止正在运行的那个孙节点；挂在 Case 上的条件不会生效，加载时给出 warning。Case 的判断节点可以跨帧运行、可以有副作用和输出，所以不能用条件替代。
- **RetryUntilSuccess / RetryUntilFailure**：子节点立即完成时，下一帧再重试；子节点 running 之后才完成时，同一帧立即重试（和 1.x 的时序一致）。
- **ForEach / Filter**：output 用来把循环变量传给子节点，节点结束时框架把 output 写回黑板，循环变量随之被清掉，不会留在循环外面。Filter 修复了 1.x 恢复执行时下标被重置为 0 的问题。
- **WaitForEvent**：用状态加 `onAbort` 移除监听，不再依赖 `TreeEvent.INTERRUPTED`。
- **Listen / Delay**：执行时注册监听或定时器，立即返回 success。回调里的子节点通过 `__tickInCallback` 执行（2.5 节）。
  - Listen 每次执行都会注册一次监听，通常要包在 `Once` 下面使用。
  - **注册属于整棵树，不属于分支**：它们执行完就结束了，不会处于 running，所以中止、抢占、`interrupt()` 都不影响已注册的监听和定时器，只有 `tree.clear()` 会移除。比如战斗分支里注册的受击监听，分支被抢占后仍然有效。
  - 需要跟着分支走的等待，用 `WaitForEvent`：它一直 running，被中止时注销监听。以后如果需要"分支运行期间持续监听"，再新增一个一直 running、被中止时注销的监听节点。
- **原来返回 `error` 的节点**（Concat、GetField、SetField、Index、Push、Includes、RandomIndex、Math、Filter）：输入类型不对时改为抛异常。Math 参数个数不对、最小值大于最大值时，也从"打日志并返回 failure"改为抛异常。
- **表达式（Check、Calculate）**：修复了求值器的几个问题：三元表达式取错了分支；`&&`、`||` 两边是布尔变量时报错；`^`、`~` 无法解析；多层属性访问（`a.b.c`）和字符串属性（`a.name == 'x'`）出错；下标里带运算（`arr[i + 1]`）解析错误。另外，只写一个变量名（比如 Check 的 `isDead`）时，原来返回的是变量名字符串（永远为真），现在返回变量的值。表达式里引用不存在的变量一律抛异常（和 1.x 一致），判断变量是否存在用 IsNull/NotNull 节点。
- **Watchdog**：删除。每帧检查条件改用 `abort: self` 的条件；被打断时的清理放进节点的 `onAbort`。

## 6. 编辑器

**发布顺序**：2.0 运行时和完成第 1 步的编辑器一起发布，第 2–4 步放在编辑器后续版本。

1. **数据层**（发布前必须完成）：编辑器解析节点时只保留已知字段，现在打开再保存会把 `conditions` 删掉。需要读写 `conditions`（条件树按普通节点递归解析，id/uuid 分配包括条件树里的节点）、保留 NodeDef 的 `preemptive`、导出时带上条件（包括条件树里引用的子树）、升级 `DOCUMENT_VERSION`。
2. **展示和编辑**、3. **校验**、4. **提示**：见下文。

- **展示**：条件以徽标的形式显示在节点顶部，标出条件项的 abort 模式和条件树根节点的名称；可以展开或折叠，或者像子树那样在独立视图里编辑。一个节点可以挂多项条件：每项一块，按数组顺序从上到下叠在节点上方，选中某一块编辑这一项；用右键菜单或快捷键上移、下移调整顺序（顺序就是求值顺序）。
- **校验**：
  - 每个条件项必须有 `root`；`abort` 只出现在条件项上；
  - 条件树不能返回 running：按 `status` 递归推导（3.4 节），不通过就报错；
  - 条件树里有 Action 类节点、或者声明了 `output` 的节点、或者节点没有声明 `status`：给出 warning；
  - 父节点不是 preemptive 时，禁用 `lower` 和 `both`；根节点的条件不能选 `lower` 和 `both`；
  - id 树内唯一（包括条件树里的节点）。
- **提示**：选中一个条件时，高亮它能影响的范围。`self` 高亮自己的子树，`lower` 高亮右侧兄弟节点的子树。
- **`.b3-setting`**：导出 `preemptive`。`status` 本来就会导出，条件树的检查直接使用它。
- **文档版本**：树文件的 `version` 是编辑器的文档格式版本（`DOCUMENT_VERSION`），运行时不检查。编辑器支持 `conditions` 时升级这个版本，旧版编辑器打开新文件会给出提示。

## 7. 性能

- 每帧多出"树深度"那么多次 `Node.tick` 调用；同时不再有 StackSlice 的 `splice`/`push` 和栈的 push/pop。
- 优化：非 json 的对象参数不再每帧 `JSON.parse`；状态用数组下标存储并保持紧凑；`Node.tick` 的热路径不创建闭包；没有子节点带 lower/both 时不做抢占检查。
- 基准测试：`npm run bench`（`test/bench.ts`），1000 个实例各 tick 1000 次，不在 `npm test` 里，改运行时前后手动对比。两棵树：`deep` 是 8 层、running 路径上有 Parallel 和 Timeout、每帧求值 Check/Calculate 表达式；`preempt` 是带 self/both 条件、敌人周期性出现和离开的抢占场景。参考值（Apple M5，Node 26）：deep 约 1050 ns/tick，preempt 约 750 ns/tick。
- 重写时和 1.x 的对比（另一棵不含表达式的 8 层树）：1.x 约 540ms，2.0 约 580ms，每帧执行的节点数大约是 1.x 的两倍。

## 8. 测试

- `npm test` 运行 `test/unit` 下的单元测试（node:test），覆盖执行模型、状态接口、每个内置节点、中止与中断、错误处理（包括异步回调和嵌套回调）、条件与抢占、表达式求值、黑板、Context 的定时器和事件、节点注册，以及多个节点组合的场景。
- `npm run bench` 运行基准测试（第 7 节）。
- `npm start` 运行 `test/main.ts`，用 `example/*.json` 跑一遍，并重新生成 `example/node-config.b3-setting`。

## 9. 不兼容改动（2.0）

- `onTick(tree, status)` 改为 `onTick(tree)`；用户自定义的组合节点和装饰节点需要重写。
- `tree.yield` / `tree.resume` 改为 `getState` / `setState` / `isRunning`。
- 删除 `Stack`、`StackSlice`、`tree.stack`。
- 删除 `Watchdog` 节点。
- 非 json 的对象参数变为只读。自定义节点如果修改过数组参数，会抛错（参数被 deep freeze，ES module 是严格模式）。
- 去掉 `error` 状态：`Status` 只有 `success`/`failure`/`running`。原来返回 `error` 的内置节点改为抛异常，树会被中断，不再当成 failure 继续执行。如果以前靠这些节点的 `error` 表达"目标不存在就走下一个分支"（比如 GetField 的对象不存在），要在前面加 NotNull 判断。自定义节点里的 `return "error"` 要改成 `this.throw(msg)`。新增 `TreeEvent.ERROR`，`TreeStatus` 新增 `"error"`。
- 表达式只写一个变量名时返回变量的值（原来返回变量名字符串，永远为真）；变量不存在时和其他写法一样抛异常。
- 树文件新增 `conditions` 字段。每一项是 `{ abort, root }`，`root` 是条件树，节点数据格式不变。

## 10. 待定问题

暂无。（原来的"编辑器什么时候放开多项 `conditions`、怎么展示和调整顺序"已经解决，见第 6 节"展示"。）
