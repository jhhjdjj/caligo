<div align="center">

<img src="web/logo.svg" width="88" height="88" alt="Caligo" />

# Caligo

**一门小巧的脚本语言：管道、模式匹配，以及一个能让你看见执行过程的 Playground。**

[![CI](https://github.com/jhhjdjj/caligo/actions/workflows/ci.yml/badge.svg)](https://github.com/jhhjdjj/caligo/actions/workflows/ci.yml)
![License: MIT](https://img.shields.io/badge/license-MIT-e9b84a)
![Dependencies: 0](https://img.shields.io/badge/dependencies-0-e9b84a)
![Node: >= 20](https://img.shields.io/badge/node-%E2%89%A520-3c873a)

[在线 Playground](https://jhhjdjj.github.io/caligo/) ·
[语言手册](docs/language.md) ·
[内置函数](docs/builtins.md) ·
[实现原理](docs/design.md) ·
[English](README.md)

</div>

---

Caligo（拉丁语「雾」）是一门可以在一个下午学会、用一个小时读完源码的
动态类型脚本语言。它有管道、模式匹配、闭包和不可变数据结构，能跑在 Node 里，也能跑在
浏览器里；自带的 Playground 可以逐句回放程序，并显示每一步的变量。

- **零依赖。** 没有解析器生成器，没有运行时库，没有构建步骤。
- **错误会指路。** 每个错误都带源码行、插入符号、修复提示和调用栈。
- **一份实现。** 命令行和浏览器 Playground 共用同一套 `src/` 模块，不会各自跑偏。
- **小到可以读。** 六个带注释的源文件，121 个测试覆盖语言、标准库和命令行。

## 三十秒上手

```caligo
fn fib(n) {
  if n < 2 { n } else { fib(n - 1) + fib(n - 2) }
}

let evenSquares = range(7)
  |> map(fn(n) { n * n })
  |> filter(fn(n) { n % 2 == 0 })

print("fib(10) = ${fib(10)}")
print("even squares: ${evenSquares}")

match evenSquares {
  [] => print("nothing"),
  [first, ...rest] => print("first ${first}, then ${len(rest)} more")
}
```

```
fib(10) = 55
even squares: [0, 4, 16, 36]
first 0, then 3 more
```

## 快速开始

只需要 Node.js 20 或更高版本，不需要安装任何依赖。

```bash
git clone https://github.com/jhhjdjj/caligo.git
cd caligo

node bin/caligo.js                          # 进入 REPL
node bin/caligo.js run examples/pipelines.caligo
node bin/caligo.js eval "sum(range(10))"    # 45
node bin/caligo.js ast examples/hello.caligo  # 打印语法树
```

本地启动 Playground：

```bash
npm run dev     # http://127.0.0.1:4173/
npm test        # 121 个测试，无需安装依赖
```

## 命令行

| 命令 | 作用 |
| --- | --- |
| `caligo` | 启动 REPL，支持 `:help`、`:clear`、`:quit`。 |
| `caligo run <文件> [参数]` | 运行 `.caligo` 程序，额外参数会放进全局变量 `args`。 |
| `caligo eval <代码>` | 执行一段代码并打印结果。 |
| `caligo ast <文件>` | 打印语法树。 |
| `caligo version` / `caligo help` | 版本号与用法。 |

`--no-color` 或环境变量 `NO_COLOR=1` 可以关闭 ANSI 颜色。运行期错误写到 stderr，
退出码为 1；用法错误退出码为 2。

## 语言一览

```caligo
// 值
let name = "world"
const answer = 42
let things = [1, "two", nil, { nested: true }]
let scores = { alice: 10, bob: 7 }

// 字符串插值
print("hello, ${name}! ${answer} squared is ${answer * answer}")

// 函数与闭包
fn add(a, b) { a + b }
let double = fn(x) { x * 2 }

// 控制流也是表达式
let mood = if answer > 10 { "high" } else { "low" }
for index, thing in things { print(index, thing) }

// 管道把左边的值作为第一个参数
let total = scores
  |> values()
  |> filter(fn(score) { score > 7 })
  |> sum()

// 模式匹配
match things {
  [] => print("empty"),
  [only] => print("just ${only}"),
  [first, ...rest] => print("${first} + ${len(rest)} more"),
  _ => print("something else")
}
```

几个值得记住的设计：

- **一切都是表达式。** `if`、代码块和函数体都会产生值，所以
  `let x = if ok { 1 } else { 2 }` 不需要任何特殊语法。
- **只有 `nil` 和 `false` 为假。** `0` 和 `""` 都是真值。
- **列表和映射不可变。** `setAt`、`append`、`put`、`merge` 都返回新值，
  语言里根本没有 `xs[i] = v` 这种写法。
- **管道把值作为第一个参数：** `x |> f(a)` 等价于 `f(x, a)`。
- **`match` 不强制穷尽**，但没有分支命中时会给出清晰的运行时错误，并提示补上
  `_ => ...`。

完整的语法、运算符优先级、模式匹配和各项限制见
[docs/language.md](docs/language.md)；标准库全表见
[docs/builtins.md](docs/builtins.md)（由源码自动生成）。

## Playground

Playground 就是同一套解释器跑在浏览器里：

- 语法高亮直接来自真正的词法分析器，而不是另写一套规则；
- 输出面板会额外显示最后一个表达式的值；
- **Trace** 标签页记录每一条执行过的语句及其变量快照；
- **AST** 标签页打印语法树；
- **Builtins** 标签页列出所有内置函数的签名与说明；
- Share 按钮把程序 gzip 后塞进 URL fragment，全程不经过服务器。

它只是普通的 HTML、CSS 和 ES 模块：用任意静态服务器打开 `index.html`
（或 `npm run dev`）即可。推送到 `main` 分支后，仓库自带的
[Pages 工作流](.github/workflows/pages.yml) 会自动发布。

## 目录结构

```
src/            语言本体：词法、语法、解释器、内置函数、错误
bin/caligo.js     命令行入口
web/            Playground 资源（无需构建）
index.html      Playground 页面
examples/       示例程序，供文档、Playground 和测试共用
docs/           语言手册、内置函数、实现说明
test/           node:test 测试
scripts/        开发服务器、站点构建、文档生成、测试入口
```

## 设计取舍

Caligo 是一个树遍历解释器：手写词法分析器、递归下降 + 优先级爬升的语法分析器，
以及带词法环境的求值器。源码位置统一使用“从文件开头算起的字符偏移”，
因此错误插入符、Trace 行号和 AST 视图永远指向同一个位置。

三个决定塑造了其余部分：

1. **换行是 token。** 换行分隔语句，但如果下一行以二元运算符开头，表达式会继续，
   于是管道可以一行行往下写。
2. **花括号是映射，关键字才引入代码块。** `{ a: 1 }` 是映射，`if x { ... }` 是代码块，
   没有歧义，也不需要复杂的前瞻。
3. **代码块是表达式，数据不可变。** 值可以从 `if` 和函数体中流出；没有通过引用修改
   数据的入口。

[docs/design.md](docs/design.md) 详细讲了整个流水线、环境模型、调用协议、追踪器和
Playground 的实现。

## 路线图

- [ ] `caligo fmt`：基于 AST 的格式化工具
- [ ] `import` / 模块
- [ ] `let` 解构
- [ ] 更丰富的模式（守卫、或模式）
- [ ] `caligo test`：运行 `.caligo` 测试文件

欢迎提 issue 或 PR，参与方式见 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 参与贡献

不需要安装、不需要构建：

```bash
npm test                    # 语言、标准库、命令行测试
npm run dev                 # 本地 Playground
npm run docs:builtins       # 重新生成 docs/builtins.md
npm run build:examples      # 从 examples/ 重新生成 web/examples.js
```

新增内置函数或语法特性的步骤清单写在
[CONTRIBUTING.md](CONTRIBUTING.md) 和 [docs/design.md](docs/design.md) 里。

## 灵感来源

Caligo 不是任何项目的分支或移植，代码是为这个项目写的。它的零件来自那些把单件事
做得更好的语言：

- 管道：Elixir、F#；
- 模式匹配：ML、Ruby、Rust；
- 默认不可变：Clojure、Elixir；
- 代码块即表达式：Ruby、Rust；
- 解释器的整体结构：*Crafting Interpreters*（想自己写一门语言的话，那是一本很好的书）。

如果你觉得它和某个项目过于相似，欢迎开 issue 提醒——目标是做一门独立、文档完整的
小语言，而不是复制品。

## 许可证

MIT，见 [LICENSE](LICENSE)。
