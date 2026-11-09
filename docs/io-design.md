# 节点输入输出设计

> 状态：已实现（3.0，破坏性改动）。替换了 2.x 里"重入时保存并恢复 `input`、`output` 和 `json` 参数"的做法，[design.md](design.md) 第 1、5、7 节已同步。

input 和 output 是节点和黑板之间的**连线**。连线的定义（变量名）是节点的配置，沿着连线流动的值只属于**一次调用**，不是节点固有的。所以把它们从节点的字段改成 `onTick` 的参数，args 则作为节点固有的配置，全部冻结。

## 1. 现状和问题

同一个树文件只创建一份 Node 实例，所有单位共享（design.md 第 1 节）。现在节点身上有三样东西属于一次调用：

- `this.input`：执行前框架从黑板读出的值；
- `this.output`：节点填写、结束时框架写回黑板的值；
- `this.args` 里的 `json` 参数：每次 tick 都用 `JSON.parse` 生成一份新副本。

节点在自己的 `onTick` 还没返回时会被再次执行，这就是**重入**：

| 场景 | 例子 |
|---|---|
| 跨树重入 | 递归的 `RunTree`；执行中同步 tick 了同一路径的另一棵树（宿主同步派发事件、直接调用 `tick`） |
| 同树重入 | `Listen` 的子节点在 `onTick` 里同步派发了它所监听的事件，`__tickInCallback` 在同一棵树上再次执行这个子节点 |

同树重入不受"树在执行中不能再 tick"的限制，因为回调执行不走 `tree.tick()`。已验证：同一棵树、同一个节点可以嵌套执行多层。

现在 `Node.tick` 用 `_depth` 计数，重入时由 `_reenter` 复制一份外层的 `input`、`output` 和 `json` 参数，内层结束后再原地写回（外层 `onTick` 可能还持有这些数组的引用）。这样做是对的，但有几个问题：

- **模型不对**：一次调用的数据挂在共享对象上，靠保存和恢复来补救；
- **代码绕**：快路径和重入路径两套逻辑，异常留下的计数要靠慢路径兜底；
- **`json` 参数的开销**：每个 `json` 参数每次 tick 都要 `JSON.parse`，不管节点会不会修改它、交出它。

## 2. 数据的归属

| 数据 | 归属 | 生命周期 | 放在哪里 |
|---|---|---|---|
| `cfg.input` / `cfg.output`（变量名） | 节点的配置：连线的定义 | 和树一样长 | `this.cfg` |
| input / output 的值 | 一次调用 | 只在本次 `onTick` 期间 | `onTick` 的参数 |
| args | 节点的配置 | 和树一样长，冻结 | `this.args` |
| 运行状态 | 一棵树 | 跨多次 tick | `tree.setState(this, ...)` |

按这个划分，Node 是不可变的共享对象，节点身上不再有任何属于一次调用的数据，重入问题也就不存在了。

## 3. API

### 3.1 onTick

```ts
abstract onTick(tree: Tree<Context, unknown>, input: readonly unknown[], output: unknown[]): Status;
```

在参数上用元组类型收窄，代替现在的 `declare input`、`declare output`。方法参数是双变的，TS 允许子类把 `unknown[]` 收窄成元组，也可以直接在参数里解构：

```ts
@registerNode
export class Filter extends Node {
    override onTick(
        tree: Tree<Context, unknown>,
        [arr]: readonly [unknown[]],
        output: [item?: unknown, result?: unknown[]],
    ): Status {
        ...
        output.push(undefined, newArr);
        return "success";
    }
}
```

- 用不到 IO 的节点照常写 `onTick(tree)`，省略后两个参数。
- 不用泛型 `Node<I, O>`：子类覆盖方法时，参数类型不会从基类推导出来，还是得再写一遍，泛型只会多一层间接。
- 类型的约束力和现在的 `declare` 一样，只是一种声明，框架不在运行时检查。

### 3.2 input 和 output 的语义

和现在一致，只是换了个位置：

- input 在执行前按 `cfg.input` 从当前作用域读出，没配置的位置是 `undefined`；值是**黑板对象的引用**，不是副本。
- output 由节点填写，可以 `push`，也可以按下标写。节点返回 `success` 或 `failure` 时，框架按 `cfg.output` 写回当前作用域，`SKIP` 表示不动这个变量；返回 `running` 或 `error` 时不写回。
- **只在本次 `onTick` 期间有效**。两个数组会被后续调用复用，不要存进闭包或字段。回调里要用的值，在 `onTick` 里先取出来存进局部变量。

### 3.3 辅助方法

`_checkOneof` 改为把 input 作为第一个参数传入：

```ts
protected _checkOneof<V>(input: readonly unknown[], inputIndex: number, argValue: V | undefined, defaultValue?: V);
```

警告信息仍然用 `cfg.input[inputIndex]` 拼出变量名。

### 3.4 删除的 API

- `Node.input`、`Node.output` 字段删除。
- `Node._depth`、`Node._reenter` 删除。

## 4. args

### 4.1 全部冻结

所有对象类型的参数（包括 `json`、`json[]`，以及 descriptor 里没声明类型的）都在构造时解析一次并 deep freeze，所有树、所有调用共享。原始类型本来就不可变。

- 节点读取参数没有任何开销，也不再每次 tick 都 `JSON.parse`。
- 修改冻结的对象会抛 `TypeError`（模块代码运行在严格模式下），被 `onTick` 的异常处理捕获，节点返回 `error`、派发 `EXCEPTION`。误用会在第一次修改时立刻暴露，不会悄悄让多棵树共享同一个对象。
- 参数类型不再决定可不可以修改。`json` 只表示编辑器里填的是一段自由格式的 JSON。

### 4.2 转交所有权：`_ownArg`

参数要交给 blackboard 或外部对象、此后归别人所有时，由**交出它的节点**复制，不由下游修改它的节点复制：下游不知道手上的值来自配置，只能每次都防御性复制，原地修改的语义也会被破坏。

```ts
/** A fresh mutable copy of the arg, for handing it out. A primitive is returned as is. */
protected _ownArg(name: string): unknown;
```

- 构造时为对象参数缓存 JSON 字符串，`_ownArg` 用它重新 parse 一份返回；没配置的参数返回 `undefined`。
- 返回值是普通的返回值，不存在节点上，没有重入问题。
- 只在真正交出值时调用，开销从"每个 `json` 参数每次 tick"降到"交出值的节点、值是对象的那一次"。

内置节点里只有 `Let` 和 `SetField` 会交出参数：

```ts
// Let
const value = this._checkOneof(input, 0, this._ownArg("value"), null);
```

`oneof` 时配置了 input 就用 input 的值（黑板对象的引用，本来就不复制），参数为空，`_ownArg` 直接返回 `undefined`。

### 4.3 规则

> args 是只读的共享配置。节点修改它会抛异常；要把它交出去，用 `_ownArg` 复制一份。

一个 running 的节点如果需要跨帧修改一份参数，就在开始时 `_ownArg`，再存进 `setState`。

## 5. 实现：帧栈

### 5.1 结构

模块级的一个帧栈，所有树、所有 context 共用：

```ts
type Frame = { readonly input: unknown[]; readonly output: unknown[] };
const frames: Frame[] = [];
let sp = 0;
```

执行全是同步的，调用严格后进先出，所以一个栈就够了。跨树重入、同树回调重入，都只是栈多了一层。帧按深度复用，内存只和最大调用深度有关，和树、节点的数量无关。

### 5.2 Node.tick

```ts
tick(tree: Tree<Context, unknown>, conditionsChecked = false): Status {
    const base = sp;
    const frame = (frames[base] ??= { input: [], output: [] });
    sp = base + 1;
    const status = this._tick(tree, conditionsChecked, frame.input, frame.output);
    sp = base;
    return status;
}
```

- `_tick` 把 `frame.input` 的长度设成 `cfg.input.length` 再逐个填入，把 `frame.output` 的长度设成 0，然后调用 `onTick(tree, input, output)`，结束后按现在的规则写回 output。
- **出栈用 `sp = base` 赋值，不用 `sp--`**：`onTick` 之外的异常（条件求值、读写黑板）从某一层逃出去时，`sp` 会停在偏高的位置，但外层节点返回时的 `sp = base` 会把它修正回来。偏高期间只是多用了几个空槽，每次调用用的都是入栈时拿到的那个帧，互不干扰。所以热路径不需要 try/finally。
- **入口在退出时恢复**：异常一直逃出根节点时，没有外层节点来修正。`tree.tick` 和 `__tickInCallback` 在入口记下 `Node.__frameDepth`，在已有的 `finally` 里恢复成这个值。是恢复成入口时的值，不是归零：跨树重入时，外层的帧还在用。
- 外层 `onTick` 持有的数组就是它自己那一帧的数组，内层调用用的是更高的帧，不会碰到它，也不需要恢复。

### 5.3 帧里的残留引用

出栈时不清空帧，热路径不多做事。帧里会留着上一次调用的值，直到同一深度再次被使用时覆盖。残留的数量受最大调用深度限制，通常下一帧就会被覆盖。如果有需要（比如单位销毁后希望尽快释放大对象），可以在最外层执行结束时清空，见第 8 节。

## 6. 迁移

| 2.x | 3.0 |
|---|---|
| `declare input: [number]` | `onTick(tree, [count]: readonly [number])` |
| `declare output: [string?]` | `onTick(tree, input, output: [string?])` |
| `const [a] = this.input` | `const [a] = input`，或者在参数里解构 |
| `this.output.push(v)` / `this.output[i] = v` | `output.push(v)` / `output[i] = v` |
| `this._checkOneof(0, args.x, d)` | `this._checkOneof(input, 0, args.x, d)` |
| 修改 `json` 参数 | 先 `_ownArg` 复制，再修改 |
| 把 `json` 参数交给黑板或外部对象 | 交出 `_ownArg` 的返回值 |
| `declare args: { value?: unknown }`（可变） | `declare args: { readonly value?: unknown }` |

`declare args` 不变：args 还是普通字段，子类继续用 `declare` 声明类型。

迁移时可能遇到的问题：

- 漏改 `this.input` / `this.output`：TS 报错，字段不存在；JS 运行时读到 `undefined`。
- 漏改修改 `json` 参数的代码：第一次修改时抛 `TypeError`，节点返回 `error` 并派发 `EXCEPTION`，堆栈指向修改的位置。

## 7. 改动清单

| 文件 | 改动 |
|---|---|
| `node.ts` | 删除 `input`、`output` 字段和 `_depth`、`_reenter`；加帧栈；`onTick` 增加 `input`、`output` 参数；`_checkOneof` 增加 `input` 参数；构造时冻结所有对象参数并缓存 JSON 字符串；新增 `_ownArg` |
| `nodes/**` | 用到 input、output 或 `_checkOneof` 的内置节点改用参数：calculate、concat、delay、filter、foreach、get-field、includes、index、is-null、let、listen、log、math、not-null、now、push、random-index、repeat、retry-until-failure、retry-until-success、run-tree、scope、set-field、timeout、wait。只读 args 的节点不用改 |
| `nodes/actions/let.ts`、`set-field.ts` | 交出参数时用 `_ownArg` |
| `tree.ts` | `tick`、`__tickInCallback` 在入口记下 `Node.__frameDepth`，退出时恢复 |
| `package.json` | 版本改为 3.0.0 |

**测试**

| 文件 | 覆盖内容 |
|---|---|
| `test/unit/reentry.test.ts` | 现有用例保留（跨树重入时外层的 input、output、参数不变）；新增同树重入：`Listen` 子节点同步派发自己监听的事件，每一层的 input 和 output 互不影响 |
| `test/unit/nodes.test.ts` | `Let`、`SetField` 每次交出的都是新副本；修改冻结参数的节点返回 `error` |
| `test/unit/helpers.ts` | 修改 `json` 参数的测试节点改用 `_ownArg`；其他测试节点改用参数 |
| `test/nodes/*` | 示例节点改用参数 |
| 新增或放进 `execution.test.ts` | `onTick` 之外的异常逃出一层后，后续调用的帧仍然正确 |

**示例和文档**

- `design.md` 第 1 节：删除"节点在执行中被重入时保存和恢复"，改成节点身上没有属于一次调用的数据，链接到本文；
- `design.md` 第 2 节执行流程第 2 步：从"准备 `json` 参数的副本"改成"把 input 读进这一帧"；
- `design.md` 第 5 节：参数语义改成第 4 节的规则；
- `design.md` 第 7 节：示例改用参数，删掉"框架在重入时保存并恢复"那一条，加上"input 和 output 只在本次 `onTick` 期间有效"和 `_ownArg`；
- `README.md` 自定义节点示例和黑板一节（"放进 `this.input`""把 `this.output` 写回"）同步；
- 运行 `npm start` 重新生成 `example/node-config.b3-setting`（descriptor 不变，确认没有差异）；
- 运行 `npm run bench`，和改动前对比。

## 8. 待定

- **`_ownArg` 的名字**：备选 `_copyArg`、`_takeArg`。
- **帧里的残留引用**：是否在最外层执行结束时清空帧（第 5.3 节）。清空的开销只出现在最外层，不影响每个节点的热路径。
- **给 JS 用户的迁移提示**：基类可以把 `input`、`output` 定义成访问器，读取时抛异常并提示改用参数。但子类里残留的 `declare input` 会触发 TS2610（基类是访问器、子类声明成属性），错误信息不直观，所以倾向不加。
