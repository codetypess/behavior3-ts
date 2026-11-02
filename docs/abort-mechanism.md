# 条件打断与抢占机制说明

> 本文从使用者和实现者的角度，说明打断（self）和抢占（lower）是怎么工作的。格式和规格细节见 [design.md](design.md) 第 4 节。

## 1. 一句话概括

- **打断（self）**：我正在运行，我的条件不成立了，我**自己退出**。
- **抢占（lower）**：别人正在运行，我的优先级更高、条件成立了，**父节点打断它，让我上**。

两者都依赖同一个前提：**每帧从根节点重入**，执行链路上的每个节点每帧都会被执行到，所以有机会做这些检查。

## 2. 基本概念

### 2.1 执行链路

每帧从根节点出发，沿着正在 running 的节点一路往下，经过的这些节点就是**执行链路**。不在链路上的节点这一帧不会被 tick，`onTick` 不会被调用。

### 2.2 条件挂在节点上

```jsonc
{
  "name": "Attack",
  "conditions": [
    {
      "abort": "both",
      "root": { "id": 4, "name": "HasEnemy" }
    }
  ],
  "children": [ ... ]
}
```

`conditions` 是数组，项与项之间是 AND。每一项由两部分组成：

- `root`：条件树，一棵不能返回 running 的小行为树，节点格式和普通节点一样。例子里只有一个节点，实际可以用 Sequence、Selector、Invert 组合出任意深度的树。
- `abort`：这棵条件树在哪些时机被检查，作用于整棵树。

后文为了简短，把条件写成 `HasEnemy (abort: both)` 这种形式，意思就是 `{ "abort": "both", "root": <HasEnemy 这棵条件树> }`。

### 2.3 优先级

在 Selector 下，**越靠左优先级越高**。抢占只能从左往右：左边的分支可以抢占右边的，反过来不行。

## 3. 三个角色：谁在什么时候检查什么

| 角色 | 负责什么 | 什么时候 | 检查哪些条件 |
|---|---|---|---|
| **节点自己**（`Node.tick`） | 能不能进入 | 节点不在 running，第一次被执行时 | 自己的**全部**条件 |
| **节点自己**（`Node.tick`） | 要不要退出（self） | 节点在 running，每帧重入时 | 自己 abort 为 `self`/`both` 的条件 |
| **父节点**（`_checkPreempt`） | 左边的分支能不能抢过来（lower） | 父节点重入、准备继续执行 running 的子节点之前 | running 子节点**左边**、带 `lower`/`both` 的兄弟节点的**全部**条件 |
| **`abort()`** | 被打断的分支怎么清理 | 发生打断或抢占时 | 不检查条件；从下往上调用 `onAbort`，清掉状态 |

关键在于：**lower 条件挂在子节点上，但执行它的是父节点。** 被检查的子节点这时并不在执行链路上，父节点只是去"问一下"它的条件：如果现在让你上，你的条件满足吗？这次查询不会执行这个子节点的行为，也不会改动它的状态。

## 4. 四种 abort 模式

| abort | 进入时检查 | 自己运行时检查（self） | 右边兄弟运行时，由父节点检查（lower） |
|---|---|---|---|
| `none` | ✓ | | |
| `self` | ✓ | ✓ | |
| `lower` | ✓ | | ✓ |
| `both` | ✓ | ✓ | ✓ |

- 不管哪种模式，**进入时都会检查**。abort 模式只决定**进入之后**还要不要继续检查。
- 抢占时检查的是**全部**条件，标准和进入一致。`lower` 只决定"要不要去检查"。这样可以避免"抢占成功、一进去就失败"。

## 5. 完整例子：守卫怪物

```
Selector  (preemptive)
├─ [0] 逃跑   conditions: [ hp < 20   (abort: lower) ]
├─ [1] 攻击   conditions: [ HasEnemy  (abort: both)  ]
└─ [2] 巡逻   Sequence[ MoveTo A, Wait 2, MoveTo B, Wait 2 ]
```

优先级：逃跑 > 攻击 > 巡逻。

### 5.1 逐帧推演

| 帧 | 场景 | 发生了什么 | 当前状态 |
|---|---|---|---|
| 1 | 满血，没有敌人 | Selector 没有状态，从 0 开始：[0] 进入检查 `hp<20` 为 false，返回 failure；[1] 进入检查 `HasEnemy` 为 false，返回 failure；[2] 开始巡逻，返回 running | 巡逻 [2] |
| 2~9 | 同上 | 抢占检查 [0]、[1] 的条件，都是 false；继续执行 [2] | 巡逻 [2] |
| 10 | **发现敌人** | 抢占检查：[0] 为 false，[1] 为 true，**抢占**。`[2].abort()` 让 MoveTo 停止移动，然后执行 [1] | 攻击 [1] |
| 11~14 | 攻击中 | 抢占检查只看 [1] 左边：[0] 为 false。重入 [1]：self 检查 `HasEnemy` 为 true，继续攻击 | 攻击 [1] |
| 15 | **血量掉到 15** | 抢占检查：[0] 的 `hp<20` 为 true，**抢占**。`[1].abort()` 取消技能，然后执行 [0] | 逃跑 [0] |
| 16~ | 逃跑中 | [0] 左边没有子节点，不做抢占检查。[0] 只配了 lower，也不做 self 检查：就算中途回血也会继续逃 | 逃跑 [0] |

另外两种情况：

- **第 12 帧敌人被打死**：重入 [1] 时 self 检查 `HasEnemy` 为 false，[1] **自己退出**并返回 failure。Selector 在同一帧里接着执行 [2]，巡逻**从头开始**，因为之前的状态已经在 abort 时清掉了。
- **第 10 帧同时满足 `hp<20` 和 `HasEnemy`**：抢占检查从左到右，[0] 先满足就直接返回，[1] 的条件这一帧都不会求值。结果是去逃跑。

### 5.2 [2] 运行时的调用栈

```
Tree.tick()
└─ root.tick()
   └─ Selector.tick()                       ← 在执行链路上
      └─ Selector.onTick()
         ├─ _checkPreempt(tree, 2)          ← 父节点发起抢占检查
         │   ├─ children[0].evalConditions()   → 只求值 [0] 的条件树
         │   └─ children[1].evalConditions()   → 只求值 [1] 的条件树
         └─ children[2].tick()               ← 真正沿执行链路往下
            ├─ evalSelfConditions()          ← [2] 自己的 self 检查（[2] 没有条件则跳过）
            └─ Patrol.onTick() → MoveTo.tick() → running
```

[0] 和 [1] 不在执行链路上，被执行的只有它们的条件树。

## 6. 不设置抢占会怎样

### 6.1 子节点的条件没有选 lower

假设 [1] 改成 `self`：

| 帧 | 发生了什么 |
|---|---|
| 10 | 发现敌人，但 Selector 不检查 [1] 的条件，继续巡逻 |
| 11~N | 一直巡逻，直到这一圈走完 |
| N | 巡逻返回 success，Selector 返回 success，这一轮结束 |
| N+1 | 从根节点重新开始，[1] 进入检查 `HasEnemy` 为 true，**这时才开始攻击** |

从发现敌人到开始反应，延迟等于巡逻剩余的时间。

### 6.2 父节点不是 preemptive

子节点就算配了 `lower` 也不生效（编辑器不允许这样配；运行时只给 warning）。父节点构造时不会计算 `_preemptors`，**[2] 运行期间 [0]、[1] 的条件完全不会被求值**，没有任何额外开销。

| 时机 | preemptive | 不是 preemptive |
|---|---|---|
| Selector 首次进入，从 0 开始 | [0] 的条件被检查（进入检查） | [0] 的条件被检查（进入检查） |
| [2] running 期间，每帧 | [0] 的条件**每帧都检查**（抢占检查） | [0] 的条件**不检查** |
| [2] 结束，下一轮重新开始 | [0] 的条件被检查（进入检查） | [0] 的条件被检查（进入检查） |

### 6.3 [1] 选不同 abort 模式的对比

| [1] 的 abort | 巡逻时发现敌人 | 攻击时敌人消失 |
|---|---|---|
| **both** | 马上打断巡逻，开始攻击 | 马上停止攻击，回去巡逻 |
| lower | 马上打断巡逻，开始攻击 | 继续攻击，直到攻击分支自己结束 |
| self | 继续巡逻，这一圈走完才攻击 | 马上停止攻击 |
| none | 继续巡逻，这一圈走完才攻击 | 继续攻击，直到攻击分支自己结束 |

## 7. 怎么选 abort 模式

| 分支的性质 | 推荐 | 例子 |
|---|---|---|
| 分支本身就是在**响应某个状态**，状态消失后再继续执行没有意义 | `both` | 有敌人就攻击；玩家在附近就打招呼；离主人太远就跟随 |
| 分支**一旦开始就该做完**，但出现时要立刻打断低优先级的分支 | `lower` | 逃跑（避免在血量阈值附近来回切换）；受击硬直 |
| 运行中条件不成立就要退出，但**不需要抢占别人** | `self` | Sequence 下的步骤；不在 Selector 下的分支 |
| 只在进入时判断一次 | `none` | 做到一半不能被打断的行为：死亡动画、读条后段、开箱 |

常见的抢占用途：

| 场景 | 高优先级分支（lower/both） | 被抢占的分支 |
|---|---|---|
| 受击硬直、眩晕 | `IsStunned` → 播放硬直动画 | 任何正在做的事 |
| 大招 | `Energy >= 100` → 释放大招 | 普通攻击连招 |
| NPC 日常 | `PlayerNearby` → 转身对话 | 干活、闲逛 |
| 宠物跟随 | `DistToOwner > 15` → 跑回主人身边 | 玩耍、探索 |
| 塔防单位 | `BossInRange` → 切换目标 | 攻击小兵 |

### 7.1 为什么要抢占，而不是给低优先级分支加反条件

目标行为：巡逻时发现敌人，立刻攻击；攻击时血量低于 20，立刻逃跑。

**只用 self。** 巡逻 running 时，没有谁会去检查左边分支的条件：父节点不做抢占，左边的分支也不在执行链路上。要让巡逻停下来，只能靠巡逻**自己**的 self 条件判断该不该退出。巡逻退出并返回 failure 后，等到 Selector 下一轮从 0 开始，左边的分支才有机会进入。所以每个分支都得挂上比它优先级高的所有分支的**反条件**：

```
Selector
├─ [0] 逃跑   conditions: [ hp < 20 ]
├─ [1] 攻击   conditions: [ HasEnemy && hp >= 20  (self) ]   ← 补上逃跑的反条件
└─ [2] 巡逻   conditions: [ !HasEnemy && hp >= 20 (self) ]   ← 补上攻击、逃跑的反条件
```

在最前面再加一个"眩晕"分支：

```
Selector
├─ [0] 眩晕   conditions: [ IsStunned ]
├─ [1] 逃跑   conditions: [ hp < 20 && !IsStunned              (self) ]   ← 要改
├─ [2] 攻击   conditions: [ HasEnemy && hp >= 20 && !IsStunned  (self) ]   ← 要改
└─ [3] 巡逻   conditions: [ !HasEnemy && hp >= 20 && !IsStunned (self) ]   ← 要改
```

这种写法有三个问题：

- **重复**：`hp >= 20` 写在好几处。阈值改成 30 就要改好几处，漏改一处就是 bug。
- **条件越堆越多**：第 N 个分支要挂前面 N-1 个分支的反条件。
- **耦合**：巡逻本来只管巡逻，现在却得知道眩晕、逃跑、攻击各自什么时候触发。

**用抢占。**

```
Selector  (preemptive)
├─ [0] 眩晕   conditions: [ IsStunned (lower) ]
├─ [1] 逃跑   conditions: [ hp < 20   (lower) ]
├─ [2] 攻击   conditions: [ HasEnemy  (both)  ]
└─ [3] 巡逻   （不用挂条件）
```

每个分支只写**自己**什么时候该上。巡逻 running 时，父节点每帧替它去问左边的分支："现在有谁要上吗？"有就打断巡逻。新加一个高优先级分支，只要插在左边、配上它自己的条件，**其他分支都不用改**。

| | 只用 self | 用抢占 |
|---|---|---|
| 谁决定让位 | 低优先级分支自己判断要不要退出 | 父节点替它去问高优先级分支 |
| 巡逻要写什么 | 所有高优先级分支的反条件 | 什么都不用写 |
| 新加一个高优先级分支 | 下面每个分支都要补一个反条件 | 只加这一个节点 |
| 改阈值 | 改多处 | 改一处 |

## 8. 规则速查

1. 每帧从根节点重入，只有执行链路上的节点会被 tick。
2. 进入任何节点之前，都要检查它的**全部**条件。
3. self：节点运行中每帧检查自己的 self/both 条件，不成立就 abort 自己并返回 failure。
4. lower：由**父节点**检查，只检查 running 子节点**左边**的兄弟节点，检查它们的**全部**条件。
5. 从左到右检查，**第一个满足的胜出**，后面的不再求值。
6. 作用域只限**直接父节点**：挂在更深节点上的 lower 条件，由它自己的直接父节点负责；那个父节点不在执行链路上时，这个条件就不会被检查。
7. 路径上每个 preemptive 的祖先都会做抢占检查，离根越近越先检查。
8. 只有声明了 `preemptive: true` 的组合节点（内置节点里只有 Selector）才做抢占检查；其他父节点下没有任何额外开销。
9. 被打断的分支会经过 `abort()`：从下往上调用 `onAbort`，清掉状态。下次再执行时**从头开始**。需要接着之前的进度，就把进度存进黑板。
10. 条件在阈值附近抖动的问题，框架不处理，由条件自己做滞回，或者在 abort 模式上选择不配 self。
11. 条件树返回 error 时不当成 false：检查条件的节点返回 `"error"`，抢占检查时由父节点返回 `"error"`，正在运行的分支被中止。

## 9. 代码骨架

省略了中断和 error 的处理：条件树返回 error 时，`evalConditions`、`evalSelfConditions` 和 `_checkPreempt` 返回 `ERROR`，节点返回 `"error"`（见 [design.md](design.md) 4.3 节）。

```ts
// Node.tick：进入检查 + self 检查
tick(tree, conditionsChecked = false) {
    if (tree.isRunning(this)) {
        if (!this.evalSelfConditions(tree)) {     // 只看 self/both 的项
            this.abort(tree);
            return "failure";
        }
    } else if (!conditionsChecked && !this.evalConditions(tree)) {   // 全部项
        return "failure";
    }
    // ……读 input、调用 onTick……
}

// 基类：抢占检查
protected _checkPreempt(tree, running: number): number {
    for (const k of this._preemptors) {           // 构造时算好：带 lower/both 的子节点下标，升序
        if (k >= running) break;                  // 只看左边
        if (this.children[k].evalConditions(tree)) return k;   // 第一个全部满足的胜出
    }
    return running;
}

// Selector.onTick
onTick(tree) {
    let i = tree.getState<number>(this);
    let checked = false;
    if (i === undefined) {
        i = 0;
    } else {
        const k = this._checkPreempt(tree, i);
        if (k !== i) {
            this.children[i].abort(tree);         // 先清理旧分支
            i = k;
            checked = true;
        }
    }
    for (; i < this.children.length; i++) {
        // 子节点在 tick 里自己做进入检查或 self 检查；刚抢占成功的子节点跳过进入检查
        const s = this.children[i].tick(tree, checked);
        checked = false;
        if (s === "running") {
            tree.setState(this, i);
            return "running";
        }
        if (s === "success") return "success";
    }
    return "failure";
}
```
