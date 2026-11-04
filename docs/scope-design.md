# 作用域黑板设计

> 状态：已实现。条件与打断的基础规则见 [design.md](design.md) 第 4 节。

本文说明条件树和 `Scope` 节点的变量隔离：条件树可以读主树的变量，写入默认只留在自己的隔离环境里；要写回外层，必须通过显式的导出。

## 1. 目标

- **条件树默认隔离**：条件树能读主树的变量，写入只留在条件自己的作用域里，求值结束就丢掉。
- **显式写回**：要写回外层，只能通过 `Scope` 的 output 导出。条件树要导出变量，就用 `Scope` 当根节点（第 7 节）。
- **`Scope` 节点**：普通子树也能用同样的机制启动一个隔离环境。
- **全局状态不走黑板**：真正的全局状态放在 context 或宿主对象上，由专门的节点读写，不经过 input/output。

## 2. 作用域黑板

每一层作用域是一个覆盖层，`values = Object.create(parent.values)`：

| 操作                     | 行为                                                                 |
| ------------------------ | -------------------------------------------------------------------- |
| `get(k)`                 | 先读当前层自己，没有就沿原型链往外找，一直到根                       |
| `set(k, v)`              | 只写当前层自己                                                       |
| `set(k, null/undefined)` | 根黑板上是 `delete`；覆盖层里存一个自有的 `undefined`，遮住外层的值  |
| `hasOwn(k)`              | 当前层自己有没有写过 `k`，导出时使用                                 |
| `unset(k)`               | 从当前层删掉 `k`，覆盖层重新读到外层的值（`Delay` 恢复暂存变量时用） |
| `fork()`                 | 以当前层为 parent，创建一个新的覆盖层                                |
| `parent`                 | 上一层，根黑板上是 `undefined`                                       |
| `_root`                  | 根黑板，覆盖层转发私有变量和临时变量时使用                           |

- **同名写入是遮蔽**：内层写一个外层已有的变量，只是在内层生成一个同名变量，外层的值不变。类似编程语言里外层变量对内层是 `const`、本层变量是 `let`，区别是这里不报错也不提示，由 `Scope` 的节点说明写明。
- **节点内部状态不参与作用域**：私有变量（`makePrivateVar`，如 `Once` 的标记）和临时变量（`makeTempVar`）是节点维护内部状态用的，不是用户变量，覆盖层的 `get`/`set` 遇到这两种前缀就直接读写根黑板。节点放进 `Scope` 或条件树，行为和现在一样；`_doInterrupt` 照常只扫描根黑板就能清掉所有临时变量。根黑板本身不做这个判断，没有用到 `Scope` 的树没有额外开销。

```ts
get<T>(k: string): T | undefined {
    if (Blackboard.isPrivateVar(k) || Blackboard.isTempVar(k)) {
        return this._root.get(k);
    }
    ...
}
```

- 表达式求值用 `this._args?.[token]` 取值，能走原型链，不用改。
- `for...in` 会遍历原型链上的键，调试输出能看到全部变量。`_doInterrupt` 只清根黑板上的临时变量，不受影响。
- 覆盖层只隔离**变量绑定**，不隔离对象本身：`get` 从外层拿到的对象是同一个引用（第 9 节）。

## 3. 作用域切换

- `tree.blackboard` 改成 getter，返回当前作用域 `_scope`；新增 `tree.__rootBlackboard` 指向根黑板，只给框架内部使用，不对宿主公开（10.2 节）。
- 不维护显式的栈，用 `__withScope` 保存和恢复，JS 的调用栈就是作用域栈：

```ts
__withScope<T>(scope: Blackboard, fn: () => T): T {
    const outer = this._scope;
    this._scope = scope;
    try {
        return fn();
    } finally {
        this._scope = outer;
    }
}
```

- 热路径（`Node.tick` 里的条件求值、`Scope.onTick`）不创建闭包，用 `__swapScope(scope)` 切换并返回之前的作用域，在 `finally` 里切回；`__withScope` 是基于它的便捷写法。
- 节点抛的异常在 `Node.tick` 里已经被捕获；中断时是一路返回 `running` 退出的，都会正常恢复。
- 作用于整棵树的操作从根黑板开始：`tick` 和 `_doInterrupt` 先切到根黑板，结束后切回原来的作用域。它们可能在绑定的回调里被调用（回调里中断或 tick 这棵树），那时当前作用域是回调绑定的覆盖层，整棵树的 `onAbort` 和节点不能用它；切回后回调剩下的部分仍在绑定的作用域里。`clear` 最后把 `_scope` 重置成根黑板。
- 结果：节点在 tick 里拿到的 `tree.blackboard`，就是它在树上的祖先中最近的那个作用域。不经过 tick 的路径（中止 `Scope`、异步回调）要重新进入（5.3 节、第 8 节）。
- 框架内部用到黑板的地方：

| 位置                            | 用途         | 使用               | 原因                                                                 |
| ------------------------------- | ------------ | ------------------ | -------------------------------------------------------------------- |
| `Node.tick` 读 input、写 output | 节点读写变量 | 当前作用域         | 隔离的入口                                                           |
| `_debugStatus`                  | 打印变量     | 当前作用域         | 打印节点实际看到的变量，包括外层                                     |
| `_doInterrupt`                  | 清理临时变量 | `__rootBlackboard` | 临时变量都在根黑板；中断可能发生在回调里，不能指望那时正好在根作用域 |
| `Tree.clear`                    | 清空整棵树   | `__rootBlackboard` | 清的是整棵树的数据                                                   |

- 根黑板的 `clear()` 改成原地清空，不再换成新对象。否则 tick 期间调用 `tree.clear()` 时，还在执行的覆盖层的原型会指向清空前的旧对象；宿主保存的 `blackboard.values` 引用也会过期。`clear` 很少调用，O(n) 的开销可以忽略。

```ts
clear() {
    const values = this._values;
    for (const k in values) {
        delete values[k];
    }
}
```

## 4. 条件树：隐式作用域

- `_evalCondition` 每次求值都 `fork` 出一个新的覆盖层，用 `__withScope` 包住 `root.tick(tree)`，求值结束就丢掉。
- 条件树里可以自由使用中间变量，比如先 `Calculate` 输出到 `tmp`，再 `Check` 它。下一次求值时这些变量都不在了。
- 条件挂在谁身上、由谁求值，覆盖层就叠在谁所在的作用域上：

```
P (preemptive Selector)          ← 当前作用域 O
├── A   conditions: [lower]      ← P 抢占检查时求值，覆盖层叠在 O 上
└── S (Scope)                    ← 覆盖层 Ss，存在 S 的状态里
    └── R (running)              ← R 的 self 条件在 R.tick 里求值，覆盖层叠在 Ss 上
```

A 的条件看不到 Ss 里的变量，即使 S 下面有节点正在 running。

条件根节点是 `Scope` 时，不再套隐式作用域，见第 7 节。

## 5. Scope 节点

### 5.1 定义

```ts
static override get descriptor(): NodeDef {
    return {
        name: "Scope",
        type: "Decorator",
        group: ["Core"],
        children: 1,
        status: ["|success", "|failure", "|running"],
        desc: "隔离作用域",
        output: ["导出变量..."],
        doc: `
            + 子节点在独立的作用域中执行，可以读取外层变量
            + 子节点的写入只影响作用域内，写外层已有的变量也只是在作用域内生成同名变量，外层不变
            + 要修改外层变量，把它列在 output 中，成功时写回外层，失败、\`error\` 和被中断时不写回
        `,
    };
}

override onTick(tree: Tree<Context, unknown>): Status {
    const scope = tree.getState<Blackboard>(this) ?? tree.blackboard.fork();
    const status = tree.__withScope(scope, () => this.children[0].tick(tree));
    if (status === "running") {
        tree.setState(this, scope);
    } else {
        // failure 时框架也会写 output，全部设成 SKIP 才能不写回
        const keys = this.cfg.output;
        const success = status === "success";
        for (let i = 0; i < keys.length; i++) {
            this.output[i] = success && scope.hasOwn(keys[i]) ? scope.get(keys[i]) : SKIP;
        }
    }
    return status;
}
```

### 5.2 生命周期

- **只在 tick 子节点期间切进去**，子节点一返回就切回来，返回 running 也一样。这一帧剩下的节点都在外层执行。
- **running 时**覆盖层存进节点状态。下一帧从根重新进入，走到这里再取出来切进去。外层作用域链每帧都会自然重建，覆盖层的 parent 每帧都是同一个对象。
- **结束或被 abort 时**节点状态被清掉，覆盖层随之丢掉；中断时 `_states` 清空，所有覆盖层一起丢掉。被回调捕获的覆盖层除外，回调还能继续使用（第 8 节）。
- **`Scope` 自己的 conditions、input、output 都在外层**：

```
Node.tick(S)
├─ 求 S 的 conditions      ← 外层
├─ 读 S 的 input           ← 外层
├─ S.onTick
│   └─ __withScope(Ss)
│       └─ child.tick      ← Ss
├─ 写 S 的 output          ← 外层（导出靠这一步）
└─ 清理 / 标记 running
```

### 5.3 中止

被抢占或父节点结束时，`S.abort()` 是从外层调用的。`Node.abort` 如果直接去中止子节点，子节点的 `onAbort` 拿到的是外层作用域。

框架不允许节点重写 `abort`（加载时检查，抛异常），所以不在 `Scope` 里重写，而是在 `Node.abort` 里用 `__isScope` 标记判断（标记见 7.1 节）：

```ts
abort(tree: Tree<Context, unknown>) {
    if (!tree.isRunning(this)) {
        return;
    }
    // Scope 的子节点要在它的覆盖层里中止，覆盖层就是它 running 时的状态
    if (this.__isScope) {
        tree.__withScope(tree.getState<Blackboard>(this)!, () => this._abortChildren(tree));
    } else {
        this._abortChildren(tree);
    }
    ...onAbort、清状态，和现在一样
}
```

- “不能重写 `abort`”这条规则保持没有例外。另一种做法是在加载检查里给 `Scope` 开例外、让它用 `super.abort` 包一层，但宿主节点覆盖 `__isScope` 就能绕过检查。
- `Scope` 不实现 `onAbort`：闭包语义下没有需要清理的东西，它自己的 `onAbort` 在外层执行也没关系。
- abort 不在热路径上，多一次判断没有影响。
- 中断时的 `_abortAll` 也一样：遍历到 running 的 `Scope` 时，在它的覆盖层里中止它的子节点。

## 6. 变量导出

### 6.1 规则

- 导出的变量写在 `Scope` 的变长 output 上，**内外层同名**。要改名，就在作用域里用 `Let` 转一下再导出。
- **只在 success 时写回**；failure、error、running、被 abort 时都不写回，相当于成功才提交的事务。条件树里尤其需要这一点：条件为 false 时节点不会执行，外层也不应该被写入任何变量。
- **只导出覆盖层自己写过的变量**：

| 内层状态                                     | 导出行为         |
| -------------------------------------------- | ---------------- |
| 自己有这个键，且有值                         | 写回外层         |
| 自己有，但值是 `undefined`（内层显式清掉了） | 删除外层的这个键 |
| 自己没有（内层没写过）                       | `SKIP`，外层不动 |

- 编辑器检查（可选）：如果导出的变量在 `Scope` 子树里没有任何节点输出它，就 warn。

### 6.2 为什么不用 `outer.get(k)` 写回

```
根:        hp = 100
└── S1 覆盖层:   (没有 hp)
    └── S2 覆盖层: (没有 hp)，导出列表里有 hp
```

如果 S2 结束时把 `outer.get("hp")` 写回：outer 是 S1，S1 自己没有，沿原型链读到根的 `100`，框架把它写到 S1，S1 就多出一个 `hp = 100`，遮住了根。之后根的 `hp` 再变化，S1 里面的节点读到的还是这个复制出来的旧值。内层没写过的变量应该什么都不写，所以用 `SKIP`。

### 6.3 SKIP 标记

和 `ERROR` 的写法一致，定义在 `node.ts` 里：

```ts
/**
 * Set to an output to leave the variable untouched, the framework doesn't write it back.
 */
export const SKIP: unique symbol = Symbol("skip");
```

`Node.tick` 写 output 的循环里遇到它就跳过：

```ts
for (let i = 0; i < outputKeys.length; i++) {
    const value = output[i];
    if (value !== SKIP) {
        blackboard.set(outputKeys[i], value);
    }
}
```

- 用 Symbol 不会和任何真实数据冲突：`undefined`/`null` 已经表示删除，其他值都可能是合法数据。
- `SKIP` 只在 output 写回这一步有意义，不会被存进黑板。带可选 output 的节点也可以用它表达“这次不写”。

## 7. 条件树导出变量

条件树要把变量交给主树（比如条件里“找最近的敌人”，找到后交给节点使用），就用 `Scope` 当条件树的根节点，在它的 output 里声明。能导出变量的只有 `Scope`，不另设 `Export` 节点。

### 7.1 根节点是 Scope 时代替隐式作用域

如果照常先套隐式作用域，`Scope` 的 output 只会写到隐式覆盖层，求值结束就丢掉了：

```
条件所在作用域 O
└── 隐式覆盖层 C        ← Scope 的 output 写到这里，随后被丢掉
    └── Scope 覆盖层 S
```

所以根节点是 `Scope` 时，不再套隐式作用域，直接 tick 它，它的 output 写到 O：

```
条件所在作用域 O        ← 只有 Scope 的 output 写到这里
└── Scope 覆盖层 S      ← 子节点写这里，求值完丢掉
```

省掉的只是隐式覆盖层，`Scope` 自己的覆盖层还在：条件树里任何节点的写入都落在 S，能写到 O 的只有 output 里声明、子树里写过的变量，而且只在条件为 true（success）时写回。可以理解为隐式作用域就是一个没有 output 的 `Scope`，根节点显式写了 `Scope`，就用这个带 output 的版本代替它。

只有根节点适用这条规则。条件树更深处的 `Scope` 照常导出到它的外层，最后随隐式覆盖层一起丢掉。

```ts
private static _evalCondition(tree: Tree<Context, unknown>, root: Node): boolean {
    const evaluate = () => {
        const status = root.tick(tree);
        if (!tree.__interrupted && status === "running") {
            root.error(`condition tree must not return 'running'`);
            root.abort(tree);   // 还在条件的作用域里
        }
        return status;
    };
    const status = root.__isScope
        ? evaluate()
        : tree.__withScope(tree.blackboard.fork(), evaluate);
    return !tree.__interrupted && status === "success";
}
```

**判断根节点是不是 Scope** 用 `Node` 上的标记，不用 `instanceof Scope`。`instanceof` 需要 `node.ts` import `scope.ts`，而 `scope.ts` 是 `class Scope extends Node`，先加载 `node.ts` 时 `Node` 还没定义，会直接报错。按名字判断（`root.name === "Scope"`）在宿主用自己的类注册同名节点时会悄悄失效。

```ts
// node.ts
/** @private Whether the node replaces the implicit scope as the root of a condition tree. */
get __isScope(): boolean {
    return false;
}

// scope.ts
override get __isScope(): boolean {
    return true;
}
```

**running 时的 abort 要放在作用域里面**。如果在 `__withScope` 返回之后才 abort，条件树里节点的 `onAbort` 拿到的是 O，写黑板就会漏到外层。根节点是 `Scope` 时，中止它会重新进入它的覆盖层（5.3 节），放在 `evaluate` 里也一样正确。

**被中断时也要在作用域里 abort**。条件树执行中抛异常或调用 `interrupt` 时，是一路返回 `running` 退出的，隐式覆盖层随后就丢掉了；如果留给之后的 `_doInterrupt`，条件树里节点的 `onAbort` 拿到的是外层作用域。所以 `evaluate` 里发现 `tree.__interrupted` 时，立即用 `__abortAll(root)` 中止条件树里所有 running 的节点（中断时 running 路径可能不完整，不能用 `root.abort`）。之后的 `_doInterrupt` 遍历到这里时它们已经不是 running，不会重复调用。

两种情况下 output 在哪里被阻断：

|                     | 根节点不是 Scope                        | 根节点是 Scope                             |
| ------------------- | --------------------------------------- | ------------------------------------------ |
| 什么时候切作用域    | tick 根节点之前，由 `_evalCondition` 切 | 根节点 `Scope.onTick` 里，只包住子节点     |
| 子节点的 output     | 写进隐式覆盖层 C                        | 写进 `Scope` 覆盖层 S                      |
| 根节点自己的 output | 写进 C，随 C 丢掉                       | 写到 O，这就是导出                         |
| 筛选                | 没有，整层丢掉                          | success 且 S 自己写过的才导出，其余 `SKIP` |
| 能到达 O 的写入     | 无                                      | success 时 output 里声明且写过的变量       |

### 7.2 不支持直接写根黑板

- 写根会绕过中间层的遮蔽，写进去了，里面的节点却读不到；
- 写根会破坏 `Scope` 的封装，看 `Scope` 的 output 不能知道这段树会改哪些变量；
- 多层写回可以用 `Scope` 的 output 一层层导出；真正的全局状态放在 context 上，由专门的节点修改。

## 8. 异步回调

`Listen` 和 `Delay` 的回调在 tick 之外执行，那时 `_scope` 已经是根黑板：

- `Delay` 自己保存了 `blackboard`，但 `__tickInCallback(child)` 里子节点用的 `tree.blackboard` 是根。
- `Listen._processOutput` 直接写 `tree.blackboard`，也是根。

改法：

- 回调节点在 `onTick` 里注册回调时，用 `tree.bindCallback(fn)` 包一层：它记下当前作用域，回调触发时切回这个作用域执行 `fn`，结束后切回原来的。
- 回调里 `tree.blackboard` 就是绑定的作用域，`Listen._processOutput` 自然写到这一层；`__tickInCallback(node)` 默认在当前作用域里 tick，也就是绑定的作用域。
- 宿主的自定义节点注册监听或定时器时，同样用 `bindCallback` 包一层，不需要接触 `__` 开头的内部方法。没有包的回调在触发时的当前作用域里执行：tick 之外是根黑板，在 tick 中同步派发时是派发者所在的作用域。
- **只绑定同步执行段**：`bindCallback` 在 `fn` 执行期间切换作用域，`fn` 里 `await` 之后的代码在之后的微任务里执行，那时作用域早已切回，读写会落到根黑板。运行环境（浏览器、游戏引擎）没有 AsyncLocalStorage 这类机制，没法让作用域跟着 `await` 走，所以直接禁止：`fn` 的返回值可能是 Promise 时编译报错（`SyncCallback` 类型），运行时返回 thenable 抛异常。异步任务在外面完成，完成时调用绑定好的同步回调。
- **清理后不再执行**：`bindCallback` 记下绑定时 `tree.clear()` 的次数，触发时树已经被清理过就直接返回 `undefined`。计数在 `clear` 的最后加一，`CLEANED`、`INTERRUPTED` 的监听在清理过程中照常执行。

```ts
override onTick(tree: Tree<Context, unknown>): Status {
    tree.context.on(
        "hit",
        tree.bindCallback((attacker) => {
            tree.blackboard.set("attacker", attacker);   // 写进注册时的作用域
            tree.__tickInCallback(this.children[0]);      // 子节点也在这个作用域里执行
        }),
        tree,
    );
    return "success";
}
```

回调触发时，所在的 `Scope` 往往已经结束了：`Listen` 和 `Delay` 都是注册完回调就立即返回 success，`Scope` 常常在同一帧就结束。这里采用**闭包语义**，和编程语言里函数返回后闭包照样能用它捕获的变量一样：

- 回调触发时重新进入**它捕获的那个作用域**，不管 `Scope` 是否已经结束。
- 回调里的写入落在捕获的覆盖层里，回调自己和它的子节点都能读到（`Listen` 输出的事件参数能被子节点读到）。
- `Scope` 结束时已经提交过导出，回调里的写入不会再导出，外面看不到。
- 读外层变量读到的是外层的当前值：原型指向的是外层的 `values` 对象本身，不是快照。
- 覆盖层被回调引用期间不会被回收；`Tree.clear` 时 `offAll` 掉回调，覆盖层随之释放。

不做 dead 标记，也不 warn。

`Listen`、`Delay` 不能放进条件树，加载时报错（它们在 NodeDef 里声明了 `deferred`，design.md 4.4 节）：条件可能被反复求值，每次都会多注册一次，回调和它捕获的覆盖层会一直累积到 `clear`。宿主自己注册回调、没有声明这个标记的节点放进条件树时，回调在那次求值的覆盖层里执行。

`Delay` 的 `cacheVars` 在回调里临时写入暂存的值，执行完子节点后恢复。恢复时区分变量原来是不是当前层自己的：是就写回旧值；原来是从外层继承的就 `unset`，删掉临时写入，而不是把旧值写回来。写回旧值会让它变成当前层的变量，之后外层再改，同一作用域里的回调读到的还是旧值。

## 9. 隔离范围

隔离的是**黑板变量的绑定**，也就是 `blackboard.set(k, v)` 不会改到外层的 `k`。变量里装的内容不在隔离范围内：

| 写入路径                           | 例子                                | 是否隔离                    |
| ---------------------------------- | ----------------------------------- | --------------------------- |
| 框架写 output                      | `Node.tick` 写回 output             | 是                          |
| 节点直接调 `tree.blackboard.set`   | `Foreach`、`Filter`、自定义节点     | 是                          |
| 节点内部状态（私有变量、临时变量） | `Once`                              | 否，始终在根黑板（第 2 节） |
| 原地修改对象                       | `SetField`、`Push`                  | 否                          |
| 宿主副作用                         | 自定义动作节点调用 `owner.attack()` | 否                          |

后两种是有意不管的：拿到对象引用的节点要改它的内容，框架防不住，也不做任何标记或检查。条件树里该放什么节点，由写树的人自己把握。

## 10. 兼容性

### 10.1 条件树的写入不再影响主树（破坏性变更）

改动之前，条件树里的写入直接进主树的黑板，“先取数据再判断”（比如条件里 `GetHp` 输出 `hp`）算出来的变量，节点里也能用。改动之后这些写入都被隔离在条件的作用域里，**依赖条件树算出来的变量的树，会悄悄读不到这个变量**。

迁移方法：把条件树的根节点包一层 `Scope`，把主树要用的变量列在它的 output 里（第 7 节）。注意导出只在条件为 true 时发生。

`example/*.json` 和单元测试里没有依赖这种写法的树。

### 10.2 宿主访问黑板

宿主在 tick 之外访问 `tree.blackboard`，拿到的就是根黑板，用法完全不变。只有 tick 里面的访问会跟着作用域走：

| 宿主怎么用                                                           | 改动后拿到的   | 是否变化                                    |
| -------------------------------------------------------------------- | -------------- | ------------------------------------------- |
| tick 之外读写，比如每帧 tick 前设置 `hp`                             | 根黑板         | 不变                                        |
| tick 之前保存引用，`const { blackboard } = tree`                     | 根黑板         | 不变                                        |
| 自定义节点在 `onTick` 里调用 `tree.blackboard.set`                   | 当前作用域     | 变化，这是预期的隔离                        |
| 节点 `onTick` 里调用宿主代码，宿主代码再访问 `tree.blackboard`       | 当前作用域     | 变化，同上                                  |
| 节点在 `onTick` 里保存 `tree.blackboard`，交给宿主的异步任务以后使用 | 保存时的作用域 | 变化，和 `Listen` 一样是闭包语义（第 8 节） |
| 节点注册的回调用 `tree.bindCallback` 包了一层                        | 注册时的作用域 | 新增的公开方法（第 8 节）                   |

- `readonly blackboard: Blackboard` 改成 getter，读取是兼容的；原来就是 readonly，宿主不会给它赋值。
- 根黑板只以 `__rootBlackboard` 的形式给框架内部使用（`_doInterrupt`、`Tree.clear`、覆盖层转发私有变量和临时变量），不提供公开的 `rootBlackboard`。公开出来，宿主的节点在 `Scope` 里调用它就能绕过隔离，这正是第 7.2 节不支持的用法；而宿主在 tick 之外用 `tree.blackboard` 就是根黑板，并不需要它。
- 宿主用 `makePrivateVar`/`makeTempVar` 维护的节点内部状态始终在根黑板，放进 `Scope` 或条件树后行为不变（第 2 节）。
- `Blackboard.clear()` 改成原地清空，宿主保存的 `blackboard.values` 引用在 `Tree.clear` 之后依然有效（第 3 节）。

## 11. 性能和注意事项

- **性能**：
    - 覆盖层的 `values` 在第一次写入时才创建（`Object.create`），没写过的覆盖层直接读外层的 `values`。只读的条件树（大多数情况）每次求值只多一个 `Blackboard` 对象。内层先写入时，会先为还没写过的外层创建 `values`，保证原型链能看到外层之后的写入。`Scope` 只在进入时 fork 一次，running 期间每帧用的是同一个覆盖层。
    - 实测（`npm run bench`，和改动前交替运行）：deep 和 preempt 都在误差范围内，没有变慢。
        - 原型链的查找深度等于嵌套层数，正常嵌套很浅。
        - 不复用覆盖层对象：条件树里的 `Listen`/`Delay` 会捕获那次求值的覆盖层（第 8 节），复用后回调会读到被清空的数据，或者别的求值写的数据。
        - 要关注的是 `tree.blackboard` 变成 getter 后，每个节点的 `tick` 都会调用一次，用 `npm run bench` 前后对比确认。
- **节点状态不受作用域影响**：`tree.setState` 的状态按节点存在 Tree 上，不在黑板里，和私有变量一样不参与作用域。

## 12. 改动清单

| 文件                        | 改动                                                                                                                                                                                                          |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `blackboard.ts`             | `parent`、`fork()`、`hasOwn()`，覆盖层里删除时存 `undefined` 遮蔽，私有变量和临时变量转发到根黑板；`clear()` 原地清空                                                                                         |
| `tree.ts`                   | `blackboard` 改 getter，新增 `__rootBlackboard`、`__withScope`、`bindCallback`；`__tickInCallback` 加 scope 参数，默认是当前作用域；中断和清理时重置作用域，`_doInterrupt` 和 `clear` 改用 `__rootBlackboard` |
| `node.ts`                   | `SKIP`；output 循环跳过 `SKIP`；`_evalCondition` 进入隐式作用域，根节点是 `Scope` 时直接 tick；`__isScope` 标记；`abort` 里判断 `__isScope`，在覆盖层里中止子节点                                             |
| `nodes/decorators/scope.ts` | 新的 `Scope` 节点，覆盖 `__isScope`                                                                                                                                                                           |
| `index.ts`                  | import `nodes/decorators/scope`                                                                                                                                                                               |
| `listen.ts`、`delay.ts`     | 用 `bindCallback` 包住回调                                                                                                                                                                                    |

**测试**

| 文件                              | 覆盖内容                                                                                                                                                                                                           |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `test/unit/scope.test.ts`（新增） | 读外层、同名遮蔽、只在 success 时导出、`SKIP` 的三种情况、跨帧 running、被抢占时子节点的 `onAbort` 在覆盖层里执行、中断、嵌套 `Scope`、私有变量和临时变量写到根黑板、`Listen`/`Delay` 的闭包语义、`clear` 原地清空 |
| `test/unit/conditions.test.ts`    | 隐式作用域的写入被丢掉；根节点是 `Scope` 时只在条件为 true 时导出；running 时的 abort 在条件的作用域里；抢占检查读的是外层                                                                                         |
| `npm run bench`                   | 改动前后各跑一次。`tree.blackboard` 变成 getter，每个节点的 `tick` 都会调用一次，确认 deep 和 preempt 两个场景没有明显变慢                                                                                         |

**示例**

- 新增 `example/test-scope.json`，在 `test/main.ts` 里加一个用例；
- 运行 `npm start` 重新生成 `example/node-config.b3-setting`，编辑器才能读到 `Scope` 的定义。

**文档**

| 文件                  | 改动                                                                                                                                                                               |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `design.md` 第 4.4 节 | “副作用靠约定”：写黑板的节点（`Let`、`Calculate`、`Now` 等）已被隔离，`Once` 的状态在根黑板，`Delay`/`Listen` 是闭包语义；剩下的只有原地修改对象（`SetField`、`Push`）和宿主副作用 |
| `design.md` 第 6 节   | 装饰节点里加上 `Scope`                                                                                                                                                             |
| `design.md` 第 7 节   | 自定义节点：`onTick` 里的 `tree.blackboard` 是当前作用域                                                                                                                           |
| `design.md` 第 8 节   | 黑板：说明作用域，链接到本文                                                                                                                                                       |
| `design.md` 第 9 节   | 编辑器：`Scope` 是普通节点，通过 `.b3-setting` 读取，不需要特殊支持；“导出变量没被写就 warn”是可选的                                                                               |
| `design.md` 第 11 节  | 测试列表加上作用域                                                                                                                                                                 |
| `README.md`           | 装饰节点列表加上 `Scope`，“黑板、输入和输出”一节提一下作用域                                                                                                                       |

## 13. 待定

无。
