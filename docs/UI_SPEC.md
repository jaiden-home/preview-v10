# UI 规范（Design Spec）

当前生效版本：**Soft UI Evolution（金融终端）**，深浅双主题，A 股语义配色（红涨绿跌）。
行情页（TradingTerminal）与交易页（PaperTrading）均已按本规范实现，作为视觉基准。

> 本文件是 AI / 开发者创建或修改页面的**唯一视觉依据**：所有新增样式必须遵循本规范；
> 如需引入新令牌（Token），必须先在 §2 登记再使用；规范未覆盖的场景，按"最接近的现有组件"类推。

## 0. AI 建页强制规则（先读这一节）

1. **配色语义不可反转**：涨/盈亏为正 = `var(--up)` 红；跌/亏损 = `var(--down)` 绿；**动作色：买入 = `--up` 红、卖出 = `--tb-active` 品牌蓝**（v2.9 起卖出不再用绿，绿只表达价格/盈亏方向；K 线图 `constants.ts` 的 `CN_UP_COLOR/CN_DOWN_COLOR` 涨跌语义不变）。禁止绿涨红跌（那是欧美惯例，本项目是 A 股语义）。
2. **禁止硬编码颜色/圆角/阴影/字号**：一律引用 §2 令牌。实底（语义色/主色）上的文字与纯白装饰件用 `var(--on-solid)`；语义色半透明描边/投影允许由 `--up/--down` 派生（如 `rgba(239,35,35,.45)`）。**由 stylelint 强制拦截**（`npm run lint:css`：组件区 `color-no-hex` + 圆角/字族白名单，令牌定义区豁免）。
3. **所有数值用等宽数字**：`font-family: var(--font-num)` + `font-variant-numeric: tabular-nums`，数字列右对齐（`.num`）。金额/价格/百分比/代码无一例外。
4. **深浅双主题必须同时可用**：只允许切换 CSS 变量取值，禁止只在单一主题下调试。正文对比度 ≥ 4.5:1。
5. **只写全局 CSS**：样式进 `src/app/globals.css`，选择器带 `#app` 前缀；禁止内联样式（动态数据色除外，如涨跌色类）。
6. **可访问性三件套**：全局 `:focus-visible` 焦点环（已内置）；可点击元素 `cursor: pointer`；`prefers-reduced-motion` 已全局降级，新动画不得绕过（动画统一走 `@keyframes` + `klinecharts-` 前缀）。
7. **交互过渡统一 `0.2s ease`**，只过渡 `background-color / color / border-color / box-shadow / filter / opacity / transform`，禁止过渡宽高。
8. **图标用内联 SVG**，禁止用 emoji 充当图标。
9. **文案双语**：`t('中文|English')`，字号按中文宽度设计，禁止因英文换行截断。
10. 完成后过一遍 §7 检查清单。

## 1. 总则与实现约定

| 约定         | 说明                                                                                                                                                                                                                            |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 样式方案     | 纯全局 CSS，单一文件 `src/app/globals.css`                                                                                                                                                                                      |
| 命名空间     | 所有选择器带 `#app` 前缀（`layout.tsx` 的 `<div id="app">` 提供隔离）                                                                                                                                                           |
| 主题机制     | 深色 = 根节点 `#app.dark`，仅切换 CSS 变量值，不改结构                                                                                                                                                                          |
| 图表内部样式 | klinecharts 画布内（轴/蜡烛/指标）由 `src/lib/chart/terminal.ts` 管理，颜色常量在 `src/lib/chart/constants.ts`，CSS 不干预                                                                                                      |
| 页面骨架     | `#app`（100vh/dvh 纵向 flex）→ 顶部 `.toolbar` → 页面内容。卡片化页面（如交易页）内容包一层 `.trade-page`（淡色底 `--page-tint`）衬托卡片，工具栏之下用 `.trade-scroll` 作**唯一滚动容器**（禁止在主区/面板再嵌 overflow 滚动） |
| 布局单位     | 间距以 2px 为基进位（2/3/4/6/8/10/12/14/16/18）；页面级栅格 gap 与 padding = `12px`（移动端 `8px`）                                                                                                                             |

## 2. 设计令牌（Design Tokens）

变量定义于 `#app`（浅色）与 `#app.dark`（深色）。**组件里只允许引用变量名。**

### 2.1 颜色

| 变量             | 浅色值                | 深色值                | 用途                                                     |
| ---------------- | --------------------- | --------------------- | -------------------------------------------------------- |
| `--bg`           | `#ffffff`             | `#121212`             | 页面根背景（终端页）                                     |
| `--page-tint`    | `#eef1f6`             | `#0e1219`             | 卡片化页面画布底（交易页）                               |
| `--tb-bg`        | `#ffffff`             | `#1c212b`             | 工具栏/卡片/表格/输入框背景                              |
| `--tb-text`      | `#1f2733`             | `#dde3ee`             | 主文本                                                   |
| `--tb-text-sub`  | `#5c6779`             | `#98a2b3`             | 次要文本（标签、提示、表头）                             |
| `--tb-border`    | `#e5e9f0`             | `#2a3140`             | 结构性边框（实线）                                       |
| `--tb-hover`     | `#f1f4f9`             | `#262d3a`             | 悬停底色/弱底色容器                                      |
| `--tb-active`    | `#1677ff`             | `#3c82f7`             | 强调色（选中、聚焦、品牌蓝、卖出动作）                   |
| `--tb-active-bg` | `rgba(22,119,255,.1)` | `rgba(22,119,255,.2)` | 选中浅底/输入聚焦光环                                    |
| `--dropdown-bg`  | `#ffffff`             | `#1c212b`             | 下拉/弹窗背景                                            |
| `--chart-grid`   | `#ededed`             | `#292929`             | 图表网格线/图表邻接虚线                                  |
| `--up`           | `#ef2323`             | `#ef2323`             | 涨/盈亏为正/买入（红，深浅共用）                         |
| `--up-bg`        | `rgba(239,35,35,.1)`  | `rgba(239,35,35,.2)`  | 语义红淡底（方向戳记等，与 `--tb-active-bg` 同范式派生） |
| `--down`         | `#14a143`             | `#14a143`             | 跌/亏损（绿，深浅共用；不用于卖出）                      |
| `--on-solid`     | `#ffffff`             | `#ffffff`             | 实底上的文字与纯白装饰件（深浅共用）                     |

### 2.2 圆角（令牌化，禁止阶外圆角）

| 令牌          | 值      | 用途                                                     |
| ------------- | ------- | -------------------------------------------------------- |
| `--radius-sm` | `8px`   | 按钮、输入框、下拉项                                     |
| `--radius-md` | `10px`  | 下拉面板、Toast、预估区、买卖分段容器、提交按钮          |
| `--radius-lg` | `12px`  | 卡片（`.trade-card`/`.trade-summary`）、弹窗             |
| （字面量）    | `6px`   | 分段控件内部按钮（比容器小一档），stylelint 白名单已登记 |
| （字面量）    | `50%`   | 圆形（主题开关滑块、脉冲圆点、清空按钮）                 |
| （字面量）    | `999px` | 胶囊（主题开关轨道）                                     |
| （字面量）    | `0`     | 组合角（如 tab 顶部圆角 `var() var() 0 0`）              |

### 2.3 阴影（柔和双层，Soft UI 核心）

| 令牌            | 浅色值                                                          | 深色值（自动切换）                                      | 用途                    |
| --------------- | --------------------------------------------------------------- | ------------------------------------------------------- | ----------------------- |
| `--shadow-card` | `0 1px 2px rgba(15,23,42,.04), 0 4px 12px rgba(15,23,42,.06)`   | `0 1px 2px rgba(0,0,0,.28), 0 6px 16px rgba(0,0,0,.34)` | 静止卡片                |
| `--shadow-pop`  | `0 4px 10px rgba(15,23,42,.08), 0 12px 32px rgba(15,23,42,.14)` | `0 8px 24px rgba(0,0,0,.5), 0 16px 40px rgba(0,0,0,.4)` | 浮层（下拉/弹窗/Toast） |

语义色投影（仅限实底 CTA / 分段选中态，`0 2px 8px`）：

- 买/涨：`box-shadow: 0 2px 8px rgba(239,35,35,.28)`
- 卖出：`box-shadow: 0 2px 8px rgba(22,119,255,.28)`（品牌蓝，v2.9 起）

### 2.4 字体

| 令牌          | 值                                                                                                              | 用途           |
| ------------- | --------------------------------------------------------------------------------------------------------------- | -------------- |
| `--font-sans` | `Inter, -apple-system, 'Segoe UI', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', system-ui, sans-serif` | 正文/标题/标签 |
| `--font-num`  | `'SF Mono', 'Cascadia Mono', 'JetBrains Mono', Menlo, Consolas, 'Roboto Mono', 'Courier New', monospace`        | 一切数值与代码 |

规则：全局行高 `1.5`（紧凑单元格 `1.3`）；数值必须 `font-family: var(--font-num)` + `font-variant-numeric: tabular-nums`；渲染 `antialiased`、`font-synthesis: none`。

### 2.5 字号阶梯（7 级，禁止阶外字号）

| 级别      | 字号/字重        | 字族 | 用途（示例类）                                                   |
| --------- | ---------------- | ---- | ---------------------------------------------------------------- |
| Display   | `26px / 700`     | num  | 总资产 `.summary-total`                                          |
| Display-S | `22px / 700`     | num  | 委托现价 `.order-price`                                          |
| CTA       | `14px / 600~700` | —    | 提交按钮 `.order-submit`(700)、统计值 `.stat-value`(600, num)    |
| Title     | `13px / 600`     | —    | 弹窗标题、`.order-name`、Toast、加载文案                         |
| Base      | `12px / 400~600` | —    | 工具栏按钮、表格正文、表单标签、预估区、`.limit-value`(600, num) |
| Secondary | `11px / 400~600` | num* | 表头 `th`、`.info-value`(600, num)、紧凑按钮                     |
| Micro     | `10px / 400`     | —    | `.stat-label`、`.info-label`、`.cell-code`(num)、`.limit-label`  |

`num*`：凡内容为数字/代码即套等宽字族，与级别无关。

### 2.6 边框规则

| 类型         | 值                                                    | 用途                                                                 |
| ------------ | ----------------------------------------------------- | -------------------------------------------------------------------- |
| 结构实线     | `1px solid var(--tb-border)`                          | toolbar 底边、卡片描边、th 底边、tab 栏底边、hero 与栅格之间的竖分隔 |
| 图表邻接虚线 | `1px dashed var(--chart-grid)`                        | 与图表衔接的分隔（info-table 底边、order-head 底边）                 |
| 输入框描边   | `1px solid var(--tb-border)`                          | 聚焦见 §2.8                                                          |
| 分隔线       | 宽 `1px` 高 `16px`，`margin: 0 8px`，色 `--tb-border` | 工具栏 `.tb-divider`                                                 |

### 2.7 间距

| 场景       | 值                                                                                                   |
| ---------- | ---------------------------------------------------------------------------------------------------- |
| 工具栏容器 | `padding: 8px 12px`，控件 `gap: 2px`（含卡片内工具栏）                                               |
| 面板/卡片  | 卡片内边距 `14px 16px`，面板纵向 `gap: 12px`（委托面板紧凑例外：`12px 14px` / `gap: 10px`，见 §3.8） |
| 页面栅格   | `gap: 12px; padding: 12px`（移动端 `8px`）；主卡边距 `margin: 12px 12px 0`                           |
| 统计单元格 | `padding: 2px 18px`，`min-width: 128px`，标签/数值 `gap: 3px`                                        |
| 信息单元格 | `padding: 4px 6px`，`gap: 2px`                                                                       |
| 数据表格   | 单元格 `padding: 10px 14px`（th 同款）                                                               |
| 弹窗       | 头/体/尾 `padding: 12px 16px`                                                                        |
| 下拉面板   | `padding: 6px`，选项 `padding: 5px 6px`                                                              |

### 2.8 交互反馈

| 状态     | 规则                                                                                                                                                              |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 过渡     | `0.2s ease`；属性限 `background-color / color / border-color / box-shadow / filter / opacity`                                                                     |
| 键盘焦点 | 全局 `:focus-visible`：`outline: 2px solid var(--tb-active); outline-offset: 2px`（已内置，勿删）                                                                 |
| 输入聚焦 | `border-color: var(--tb-active)` + `box-shadow: 0 0 0 3px var(--tb-active-bg)`；checkbox `accent-color: var(--tb-active)`                                         |
| 悬停     | 按钮/表格行：底色 `var(--tb-hover)`                                                                                                                               |
| 选中     | 工具栏按钮：`--tb-active` 文 + `--tb-active-bg` 底 + 600 字重；分段选中：白字 + `--tb-active` 实底；买/卖选中：白字 + 滑块 `--up`/`--tb-active` 实底 + 语义色投影 |
| 禁用     | `opacity: 0.5; cursor: not-allowed`                                                                                                                               |
| 降级     | `prefers-reduced-motion: reduce` 时全局动画/过渡归零（已内置）                                                                                                    |
| 滚动条   | 细滚动条（8px、胶囊 thumb `--tb-border`，悬停 `--tb-text-sub`，track 透明；Firefox `scrollbar-width: thin`），随主题切换                                          |
| 选区     | `::selection` = `--tb-active` 底 + `var(--on-solid)` 字                                                                                                           |

## 3. 组件规范

### 3.1 页面骨架与卡片

- 卡片化页面（交易页）：内容包 `.trade-page`（`flex: 1; min-height: 0; flex-column; background: var(--page-tint)`），卡片浮于其上；工具栏之下的 `.trade-scroll`（`flex: 1; min-height: 0; overflow-y: auto`）承载全部内容滚动，卡片随内容自然撑高。
- 卡片 `.trade-card`：`--tb-bg` + `1px solid --tb-border` + `--radius-lg` + `var(--shadow-card)`。卡片内首行若是工具栏，底部加结构实线。
- 终端页（行情页）不铺卡片，保持通栏：toolbar → info-table → 图表。

### 3.2 账户摘要（.panel-summary，嵌入委托面板末段）

结构：`summary-head`（总资产标签 + 重置账户幽灵按钮，卡片右上角动作位，按钮 40px 与面板控件统一）→ `summary-hero`（Display 总额、总盈亏语义色）→ `summary-grid`（2×2 次指标：当日盈亏 / 可用资金 / 持仓市值 / 持仓盈亏）。

- 摘要与委托表单同卡（`.trade-panel`，§3.8），是卡内**末段**（v2.9 起段序：行情 → 交易 → 资产）：纵向 `gap: 6px`，`padding-top: 10px` + 顶部结构实线与委托区分隔；指标栅格行距 `6px`。
- 栅格右列单元格加 `1px` 左竖分隔线（`--tb-border`）+ `padding-left: 12px`；hero 与栅格之间以行距分组，不画线。
- 任何"关键指标区"（账户/策略/组合）复用此范式：hero 放主指标，grid 放次指标；窄容器 2×2，宽容器可平铺 1×4。
- 主区首行高度由**面板内容驱动**：`grid-template-rows: minmax(410px, auto) auto`（保底 410px），图表卡 `min-height: 410px` 等高跟随、画布经 flex 自适应。**禁止给首行挂 vh/上限**——否则高视口下会把面板拉伸出大片空白；画布容器 `.trade-chart-body` 须 `contain: size`（画布内联高度不得污染 auto 行轨），且钩子须挂 `ResizeObserver` 调 `chart.resize()`（klinecharts 不自动跟随容器伸缩）。

### 3.3 工具栏（.toolbar / .trade-chart-toolbar）

- 横向 flex、可换行、`gap: 2px`、`padding: 8px 12px`、背景 `--tb-bg`、底部结构实线。
- `.tb-btn`：`12px`、`padding: 5px 10px`、圆角 `--radius-sm`、透明底。
- 主操作（`.tb-symbol`）：600 字重 + `--tb-active` 文 + `--tb-active-bg` 胶囊。
- 幽灵按钮（`.tb-clear`）：次要色文字，悬停恢复主文本色。
- 分段控件 `.period-group`：容器 `padding: 2px` + `--tb-hover` 底 + `--radius-sm`；内部按钮 `padding: 2px 10px` 圆角 `6px`。
- 主题开关推至最右（`margin-left: auto`）；卡片内工具栏需覆盖该规则。

### 3.4 输入框（标准规格）

`font-family: var(--font-num); font-size: 13px; padding: 8px 10px; border: 1px solid var(--tb-border); border-radius: var(--radius-sm); background: var(--tb-bg)`，聚焦按 §2.8。适用于搜索框、参数输入。委托面板内输入框为与按钮统一高度，用 `height: 40px; padding: 0 10px`（§3.8）。

### 3.5 下拉面板与弹窗

- 下拉：`--dropdown-bg` + `1px --tb-border` + `--radius-md` + `var(--shadow-pop)`，距按钮 `6px`；选项 `.tb-btn`/`.check-row`。
- 弹窗：宽 `320px`、`--radius-lg` + `var(--shadow-pop)`；标题 Title 级；页脚主按钮 `--tb-active` 实底。

### 3.6 信息表格（.info-table）

8 列网格（移动端 4 列），字号 `11px`；仅保留下边框（图表邻接虚线）；单元格上标签（Micro）下数值（Secondary/600/num），居中。卡片内使用时同样只留下边框。

### 3.7 数据表格与标签页

- `.trade-table`：正文 Base `12px`、th Secondary `11px/500` + `letter-spacing: .02em`、单元格 `10px 14px`、行悬停 `--tb-hover`（行加 `0.2s` 过渡）。
- 成交时间列仅日期：记录层 `TradeRecord.ts` 落账即截断至本地日界（不含时分秒）；展示为 zh `yyyy/mm/dd`、en `mm/dd/yyyy`（v2.20 起）。
- 数字列 `.num` 右对齐 + 等宽字族；标的列 `.cell-symbol` 上名称（600）下代码（Micro/num）。
- 方向语义：`up/down/flat` 类（`--up/--down/--tb-text`），涨跌值与现价都要套；成交方向列买 `.up`、卖 `.accent`（`--tb-active`）。
- 标签行 `.trade-tabs`：复用 `.tb-btn`，容器 `padding: 8px 12px 0` + 底部结构实线，选中态同工具栏按钮。

### 3.8 委托面板（.trade-panel / .order-body）

- 容器 `.trade-panel`（`trade-main` 右列）：标的行情、委托表单与账户摘要同卡，单卡三段式（v2.9 起段序：**行情 → 交易 → 资产**），纵向 `gap: 10px`、`padding: 12px 14px`（紧凑表单例外，低于 §2.7 卡片基准）；表单区 `.order-body` 纵向 `gap: 8px` 且 `flex: 1` 弹性填充卡内剩余高度，提交按钮 `margin-top: auto` 锚定在账户摘要之上（行高被图表 `clamp` 推高时不留悬空空白）。**面板内全部按钮与输入框统一 `height: 40px`**（重置 / 买卖切换 / 快捷仓位 / 提交 / 价格数量输入），满足 §5 主要操作 ≥40px；两卡高度由 `trade-main` 首行网格自动同步。
- 行情段（头部）：名称 Title + 代码 Secondary；现价 Display-S + 涨跌 Secondary，红涨绿跌；底部图表邻接虚线，`padding-bottom: 6px`。
- 买卖切换（滑块式分段）：容器 `--tb-hover` 底 + `--radius-md` + `padding: 2px`，内嵌绝对定位滑块 `.side-thumb`（`width: calc(50% - 2px)`、圆角 `6px`，与单枚按钮等宽），切换时 `transform: translateX(0 → 100%)` + 颜色红↔蓝同步 `0.2s ease` 过渡；`.side-btn` `12px/600; height: 40px` 透明底盖于滑块之上（`z-index: 1`），选中白字。
- 字段区双列（`.order-fields`，`1fr 1fr`，`gap: 8px`）：委托价格 / 委托数量并排（标签行仅放文字，禁止塞入按钮等宽于半列的内容）；快捷仓位按钮（买卖同款 **1/2仓 / 1/3仓 / 1/4仓 / 全仓**，按最大可买或可卖取整手、全仓卖出含零股）为字段区下方整行等宽按钮（Secondary/num，`height: 40px`，`--tb-hover` 底 + `--radius-sm`，悬停换 `--tb-border` 底）。
- 涨跌停与侧别上下文 `.order-limits`：三枚描边小格（`.limit-cell`，`--tb-bg` 底 + `--tb-border` 描边 + `--radius-sm`，标签上 Micro、数值下 Base/600/num、居中）——涨停值 `--up` 红、跌停值 `--down` 绿、最大可买/可卖 `--tb-active` 蓝（`.accent`），缺行情以 `--` 占位；与费用预估的淡底整带构成两级数据容器语言。可用资金不重复展示（摘要栅格已有）。
- 费用预估 `.order-estimate`：三列统计（`.estimate-cell`，标签上 Micro、数值下 CTA/num），`--tb-hover` 底 + `--radius-md`，与摘要栅格同范式。
- 提交 `.order-submit`：CTA `14px/700; height: 40px; --radius-md`，买 `--up` 卖 `--tb-active` + 语义色投影，悬停 `brightness(1.06)`。

### 3.9 Toast 与加载

- Toast：底部居中悬浮，`role="status"` + 状态图标（成功 ✓ / 失败 ✗，内联 SVG 14px，`currentColor`）+ Title 白字，`--radius-md` + `var(--shadow-pop)`，成功 `--down` / 失败 `--up`，`0.2s ease` 入场，3s 自动消隐。
- 加载：文案居中（`.trade-loading`）或脉冲圆点（`.fundamental-loading`，`@keyframes` 前缀 `klinecharts-`）。

### 3.10 空状态（.trade-empty / .order-untradable 范式）

结构：内联 SVG 图标（36px、`stroke: currentColor`、容器色 `var(--tb-border)`）+ 主文案 `.trade-empty-title`（Title 级主文本色）+ 副文案 `.trade-empty-sub`（Secondary 次要色，引导下一步操作），纵向居中，`padding: 40px 16px 36px`。

- 适用：持仓空态、成交记录空态、委托面板不可交易提示（`.order-untradable`，图标 32px + 单句文案）。
- 新增空状态一律复用此范式，图标必须内联 SVG（`aria-hidden`），禁止纯文字或 emoji。

### 3.11 移动端交易坞与底部弹层（≤768px，交易页专属，v2.10）

- 悬浮交易坞 `.trade-dock-bar`（桌面 `display:none`）：`--tb-bg` 底（由弹层卡提供）+ `--radius-lg` 顶圆角 + `var(--shadow-pop)`；**高度分态**——收合态 `72px + env(safe-area-inset-bottom)`（`--dock-h`），展开态 `56px + 安全区`（`--dock-h-open`，竖向内边距 5px，高度瞬切、面板经 `transform` 滑出；图表高度/记录让位/收合位移按收合态计算，弹层可用高度按展开态计算）。排版为**双 22px 锚点**行情头式：左 = 展开箭头（18px 内联 SVG，展开时旋转 180°）+ 名称 Display-S 22px/700（与 `.summary-total` 同尺）+ 代码 Micro/num；右 = 现价 22px/700/num（语义色，与名称同尺同字重）+ 涨跌 Secondary 11/600/num；间距：图标↔文本 12px、栈内 2px、水平内边距 16px、收合态竖向 8px。整条为单一按钮，`aria-expanded` + `aria-controls` 指向弹层。
- 主题开关双位渲染：`ThemeToggle` 支持 `id`/`itemClassName`（同页双实例 id 须唯一）；交易页移动端主题开关并入 `.trade-chart-toolbar` 收尾（对齐首页「功能按钮 + 主题」行，顶部实例 `theme-at-top` 隐藏），桌面只在顶部工具栏显示（图表栏内实例 `theme-in-chart` 隐藏），两实例共用 `chart.toggleTheme`。
- 底部弹层：`.trade-panel` 移动端 `position: fixed`（左右贴边、底部锚定，z-index 1100），收合态 `transform: translateY(calc(100% - 交易坞高度))` 仅露坞条，`.open` 展开整卡；仅过渡 `transform 0.2s ease`。阴影 = 向上微投影 `0 -4px 16px rgba(15,23,42,.08)`（--shadow-pop 同族基色派生，强调自底部升起的浮层感）叠加 `var(--shadow-pop)`。遮罩 `.trade-sheet-mask` 同款定位、底色减淡 `rgba(0,0,0,.3)`（z-index 1090）；层序：下拉 100 < 遮罩 1090 < 弹层 1100 < Toast 1200。
- 弹层内容 `.trade-panel-body`：**整卡（坞条 + 内容）不超过视口 75%**（`max-height: calc(75dvh - 展开坞高 - 1px)`，`vh` 兜底）；弹层高度由内容自然撑高（不设 min-height），内容经紧凑化 + 美化重调（v2.16：间距层级化——组内表单 `6px` / 单元格 `2~3px`、组间正文 `8px`，数据行行高 `1.4`，容器内边距 `10px 14px`；**涨跌停/最大可买小格 `.limit-cell` 移动端改单行横排**（标签+值内联，省一整行高度；§3.8 竖排为桌面形态）；控件整体降档（产品决策，§5 触控基线的移动端弹层例外）：主要操作（买卖切换/价格数量输入/提交）`36px`、快捷仓位 `32px`、重置 `28px`、字段标签 Secondary `11px` / 总资产 `22px` Display-S 级；**账户摘要移动端重排 + 层次化（v2.17~v2.18）**：摘要段收进整段淡底**资产带**（复用 `.order-estimate` 的 `--tb-hover` + `--radius-md` 容器语言，替代顶部结构实线作段分隔）；带内 hero 双锚点——总资产大数居左、总盈亏居右基线对齐（延续交易坞左右锚点语言；行距 `4px` / 列距 `8px` 防粘连，盈亏右对齐、极窄屏仅在自身列内换行不悬挂，修复 v2.15 左贴紧挤压）；四指标维持一行四列、补 `6px` 列距并改**居中**排版（对齐 `.info-table` 移动端 4 列范式，值维持 11px 防 7 位金额溢出），形成「带容器 + 居中指标」两级层次（桌面/平板不变，§3.2）），整卡自然高度 ≈ 465px、弹层体 408px（375 宽实测），**≥620px 高的直板视口整卡不出现内部滚动**（667px 视口实测无滚动），`overflow-y: auto` 仅作横屏/极矮视口兜底（弹窗豁免 §1 唯一滚动容器约束）；`padding` 底部让出安全区；弹层内隐藏 `.order-head`（行情摘要由交易坞承载，去重；桌面面板行情段保留）。Escape / 遮罩点击 / 再点坞条收起；展开期间 `.trade-page.sheet-open` 锁定 `.trade-scroll`。
- 记录卡移动端列表模式：`.trade-records` 通栏与图表融合（零间隙连续表面：去描边/圆角/阴影/边距，`padding-top: 8px` 呼吸位——首屏标签页位于悬浮坞后方、滚动自坞下滑出，`padding-bottom: 交易坞高度 + 10px` 保证末尾内容不被遮挡），内宽表（`.trade-table-wrap`）隐藏，改「回执票据」式信息卡列表 `.trade-list`（v2.23 重设计，去表格化——无竖分隔线/居中列/均分格）：`.list-item` 纵向两段——`list-head` 头部**双锚点**（延续交易坞与摘要 hero 语言）：左身份栈 `list-id` = 名称 13/600（成交含方向**戳记** `.list-side` 语义色淡底胶囊：买入 `--up` 字 + `--up-bg` 底 / 卖出 `--tb-active` 字 + `--tb-active-bg` 底，10/600）+ 代码（`cell-code`）；右数字栈 `list-hero` 右对齐 = 盈亏大数 `.list-hero-value`（持仓=浮动盈亏 / 成交=已实现盈亏，**16/700/num 语义色**，卡片最响元素；成交买入 `--`）+ 元信息 `.list-hero-sub`（持仓=盈亏%（语义色）/ 成交=日期，10px 次要色）；`list-stats` 淡底统计带（复用 `.order-estimate` 容器语言：`--tb-hover` 底 + `--radius-md` + `padding: 6px 10px`）内四项 `.list-stat`（标签上 10px 次要色 / 数值下 11/600/num，`space-between` 分散、无分隔线；持仓 = 持仓可卖/成本价/现价/市值，成交 = 价格/数量/金额/费用），值全部 nowrap 不换行、卡片高度统一；成交方向为名称行内前缀 `.list-side`（买入红 / 卖出蓝）；条目间结构实线分隔；标签页 `.trade-tabs` 移动端转**滑块式分段**（复用 §3.8 `side-tabs` 滑块范式：通栏方角分段头带（`--tb-hover` 轨道、`padding: 2px`、圆角 0、两端锚定屏幕边缘，与工具栏同语言），`.tabs-thumb`（`calc(50% - 2px)` 宽、圆角 6px、`--tb-active` 实底 + 品牌蓝投影）经 `translateX(0 → 100%)` 平移 0.2s ease，选中白字；按钮 40px 高、`basis 0` 均分；桌面为常规标签按钮，滑块隐藏）。桌面宽表与平板横滚表不变。
- 图表卡通栏化对齐行情页：`.trade-chart` 移动端去描边/圆角/阴影，`height: calc(100dvh - 交易坞高度)`（`vh` 兜底 + `dvh`），`min-height: 420px`；顶部工具栏移动端整体隐藏（返回与主题均已并入卡内工具栏）。卡内工具栏固定 **2 行**（flex `order` + 0 高强制换行元素 `.tb-line-break`（`flex-basis: 100%; height: 0; order: 1`，桌面隐藏））：行 1 = 返回 + 周期分段 + 主题开关（收尾靠右），返回为微信式左箭头图标按钮（`.tb-back`，内联 SVG、36px 触控、`aria-label`，桌面隐藏并保留顶部文字链），周期分段 `flex: 1 1 auto` 铺满剩余宽度；行 2 = 功能按钮整行等宽居中（侧 `padding: 6px 4px` 保证窄屏单行，单行内 grow 均分视觉等宽不变）；工具栏 `padding: 6px 8px` / `gap: 6px`，分段内部沿用 `#app .period-group` 未加作用域的等宽规则；`.trade-main` 移动端 `padding: 0; gap: 0`，记录卡通栏紧随图表之下（见上条，零间隙融合）。

### 3.12 首页入口页（.home-page，v2.25）

- 结构：`.home-page`（复用卡片化页面范式：`--page-tint` 画布 + 顶部工具栏）→ `.home-main`（唯一滚动容器，垂直水平居中，纵向 `gap: 18px`、`padding: 18px 12px`）→ `.home-hero`（Display-S `22/700` 标题 + Base 副文案，居中）+ `.home-grid`（双列等宽入口卡，`gap: 12px`、`max-width: 640px`；≤768px 转单列 `max-width: 360px` 窄幅、侧距 `8px`）。
- 工具栏：品牌名 `.home-brand`（Title 级静态文本，非按钮）左锚点 + 主题开关推右；首页无图表，主题切换为独立实现（同款 `#app.dark` + `.theme-switching` 抑制过渡，不经 useChartTerminal）。
- 入口卡 `.home-card`（整卡链接）：`.trade-card` 同款壳（`--tb-bg` + `1px --tb-border` + `--radius-lg` + `--shadow-card`，`padding: 16px 18px`、纵向 `gap: 8px`）；悬停描边换强调色 + 阴影升 `--shadow-pop`（仅 `border-color / box-shadow / color` 过渡）。
- 卡内结构：头行 `.home-card-head`（左 `.home-card-icon` 40px 淡底圆角块 `--radius-md` + 内联 SVG 22px `stroke: currentColor`；右 `.home-card-arrow` 14px 次要色箭头，悬停随卡换强调色）→ 标题 Title `13/600` → 副文案 Secondary `11px` 次要色。
- 语义色：行情看板卡 = 品牌蓝（icon `--tb-active` + `--tb-active-bg`）；模拟交易卡 = 买入红（icon `--up` + `--up-bg`，呼应 §0 买入动作色，绿不参与）；两卡悬停描边/箭头随各自语义色。

## 4. 响应式断点

- 平板（769–1024px）：交易页委托面板（含账户摘要）收窄至 `320px`（摘要栅格维持 2×2）。
- 移动端（≤768px）：
  - 工具栏：`gap: 6px; padding: 6px 8px`，隐藏分隔线，按钮整行等宽，标的按钮占满首行。
  - 信息表格降 4 列 `10px`；下拉右对齐防溢出。
  - 交易页（v2.10）：图表卡转通栏终端式对齐行情页（去卡片壳、首屏占满），记录卡在其下滚动；委托面板转悬浮交易坞 + 底部弹层（§3.11）；账户摘要移动端淡底资产带 + hero 双锚点 + 一行四列居中（v2.17~v2.18，见 §3.11）。

## 5. 无障碍基线

- 正文对比度 ≥ 4.5:1（当前令牌浅/深两套均达标，改令牌时必须复核）。
- 全局焦点环、`cursor: pointer`、`prefers-reduced-motion` 见 §2.8，禁止局部删除。
- 图标禁止无标签裸按钮（icon-only 必须带 `aria-label`）；涨跌不允许只靠颜色表达，需伴随 +/- 号或文字（现有 `fmtSignedMoney`/`fmtPct` 已保证）。
- 触控目标：主要操作 ≥ 40px 高。交易页移动端弹层控件经产品决策降档（主要操作 36px / 次要控件 28px，§3.11 v2.13），为该基线唯一例外。

## 6. 变更记录

| 版本  | 变更                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| v1    | 交易页对齐行情页：统一令牌、涨跌语义色去硬编码、过渡与禁用态补齐                                                                                                                                                                                                                                                                                                                                                                                           |
| v2    | Soft UI Evolution 改版：圆角/阴影/字族令牌化（8/10/12px + 双层阴影 + 等宽数字）、总资产主卡、分段控件、胶囊操作按钮、交易页淡色画布、全局焦点环与动效降级                                                                                                                                                                                                                                                                                                  |
| v2.1  | 规范工程化：新增 `--on-solid` 令牌（组件区 hex 清零）、stylelint 强制（`lint:css`，pre-commit/CI 接入）、Trae 项目规则入口 `.trae/rules/project_rules.md`、遗留 4px 圆角统一 `--radius-sm`                                                                                                                                                                                                                                                                 |
| v2.2  | 体验细化：滚动条/选区主题化、平板断点（769–1024px）、空状态范式（§3.10，图标+主副文案）、Toast 状态图标 + `role="status"`                                                                                                                                                                                                                                                                                                                                  |
| v2.3  | 交易页排版修复：新增 `.trade-scroll` 唯一滚动容器（去除主区/委托面板嵌套滚动，修复面板底部被静默裁剪）；汇总卡统计单元格等宽分布 + 竖分隔线；图表卡高度 `clamp(480px, 60vh, 720px)`（移动端 `420px`）；`#app` 视口高度补 `100dvh` 兜底                                                                                                                                                                                                                     |
| v2.4  | 布局整合：总资产主卡并入委托面板，右侧单卡三段式（账户摘要 → 标的行情 → 委托表单，`.trade-panel` + `.order-body`），去除主区上方通栏卡；摘要 hero 重排（标签行 + 重置右上角），栅格固定 2×2 右列竖分隔线；持仓/成交记录卡重命名 `.trade-right` → `.trade-records`（消除与右列 `trade-panel` 的命名混淆）                                                                                                                                                   |
| v2.5  | 交易页首行降高（典型视口不出滚动条）：图表卡 `clamp(410px, calc(50vh + 10px), 650px)`；委托面板紧凑化——价格/数量改双列字段（`.order-fields`）、涨跌停/最大可买合并为微提示行（`.order-field-hints`）、预估区改三列统计（`.estimate-cell`，`padding: 8px 12px`）、分段按钮 `6px` 收窄，面板 `12px 14px`、表单区 `gap: 8px`、摘要 `gap: 6px`；快捷仓位按钮保持字段区下方整行等宽（半宽标签行禁止塞按钮，防溢出错版）                                         |
| v2.6  | 委托面板控件高度统一：重置 / 买卖切换 / 快捷仓位 / 提交按钮与价格数量输入框统一 `height: 40px`（满足主要操作 ≥40px 触控基线）；面板高度变化经 `trade-main` 首行网格自动同步至图表卡                                                                                                                                                                                                                                                                        |
| v2.7  | 委托面板再降高（控件保持 40px 统一）：去除冗余 `.order-avail` 行（可用资金与摘要栅格重复；可卖数量并入微提示行，仅持仓时展示），预估区 `padding: 6px 12px`、摘要底距 `8px`、栅格行距 `6px`、分段容器 `padding: 2px` 收紧；`.order-body` 弹性填充 + 提交按钮锚定卡底（行高被图表 clamp 推高时消除底部悬空空白）                                                                                                                                             |
| v2.8  | 修复面板大量空白（根因）：首行高度改由面板内容驱动（`minmax(410px, auto)`，图表 `min-height: 410px` 等高跟随），去除 `50vh`/上限挂载；画布容器 `contain: size` 阻断 canvas 内联高度污染 auto 行轨；`useChartTerminal` 挂 `ResizeObserver` + `ChartTerminal.resize()` 使画布跟随容器伸缩；不可交易态提示 `flex: 1` 居中填充                                                                                                                                 |
| v2.9  | 委托面板重设计：段序改为 行情 → 交易 → 资产（摘要移至卡底，分隔线改顶部结构实线）；买卖切换改滑块式分段（`.side-thumb` 平移 + 红蓝换色动画）；**卖出动作色由绿改品牌蓝 `--tb-active`**（滑块/提交按钮/持仓表卖按钮/成交方向列同步，绿仅表涨跌与盈亏）；涨跌停/最大可买由微提示行升级为三枚描边小格 `.order-limits`（值按 涨停红/跌停绿/侧别蓝 区分）                                                                                                       |
| v2.10 | 交易页移动端改版（新增 §3.11，桌面/平板不变）：图表卡通栏化对齐行情页（去卡片壳、`100dvh − 工具栏 − 交易坞` 首屏占满，卡内工具栏同步首页移动端布局：间距 6px 8px、分段独占一行、功能按钮整行等宽）；委托面板转悬浮交易坞 `.trade-dock-bar`（52px + 安全区，名称/现价/涨跌摘要，点击展开）+ 底部弹层（`transform` 收合、遮罩 1090/弹层 1100、容器内滚动、Escape/遮罩收起、背景滚动锁定）                                                                    |
| v2.11 | 交易页移动端弹层压高去滚动（仅 ≤768px，桌面/平板与其他页面不变）：弹层内容深度紧凑化——间距降档（表单 4px / 正文 6px / 摘要 3px / 单元格 1~2px）、数据行紧凑行高 1.3、快捷仓位 36→32px、字段标签 12→10px、摘要指标值 14→12px；高度上限与实现对齐为 75dvh 并补 `vh` 兜底（原规范 58% 与代码不符）；压缩后典型直板机整卡自然高度低于上限、不出现内部滚动，`overflow-y` 仅作横屏/极矮视口兜底                                                                  |
| v2.12 | 交易页移动端弹层再压高（仅 ≤768px）：涨跌停/最大可买小格 `.limit-cell` 改单行横排（标签+值内联，省一整行高度）、表单/正文间距再降档（3px / 4px）、摘要上距收窄（6→4px）；弹层自然高度降至 ≈410px，≥615px 高的直板视口亦免内部滚动，滚动兜底范围进一步缩小                                                                                                                                                                                                  |
| v2.13 | 交易页移动端弹层控件降档（仅 ≤768px，§5 触控基线的唯一例外）：主要操作（买卖切换/价格数量输入/提交）40→36px、次要控件（快捷仓位/重置）32→28px；弹层自然高度降至 ≈390px，≥595px 高的直板视口免内部滚动                                                                                                                                                                                                                                                      |
| v2.14 | 交易页移动端摘要栅格 2×2 转一行四列（仅 ≤768px；去竖分隔线让出列宽，指标值 12→11px 防 7 位数金额溢出，桌面/平板 2×2 不变）；弹层自然高度降至 ≈357px，≥552px 高的直板视口免内部滚动                                                                                                                                                                                                                                                                         |
| v2.15 | 交易页移动端摘要 hero 单行化（仅 ≤768px）：总盈亏与总资产大数同行基线对齐、hero 内 `gap: 0` 整体贴紧（省一行高度；桌面竖排不变）；弹层自然高度降至 ≈340px，≥530px 高的直板视口免内部滚动                                                                                                                                                                                                                                                                   |
| v2.16 | 交易页移动端弹层美化重调（仅 ≤768px，紧凑与美观再平衡）：间距层级化（组内表单 6px / 单元格 2~3px、组间正文 8px）、数据行行高 1.3→1.4、容器内边距回调（10px 14px / 12px+安全区）、涨跌停小格与费用预估内边距恢复呼吸（4px 8px / 6px 12px）、快捷仓位 28→32px、字段标签 10→11px；自然高度 ≈390px，≥595px 视口仍免内部滚动                                                                                                                                    |
| v2.17 | 交易页移动端账户摘要重排（仅 ≤768px，不增高）：hero 主行改双锚点——总资产居左、总盈亏居右基线对齐（行距 2px / 列距 8px，右对齐换行不悬挂），修复 v2.15 左贴紧挤压形态；指标栅格一行四列补 6px 列距，修复金额与邻列贴边拥挤（值维持 11px 防溢出）；弹层体高度与 v2.16 持平（375 宽实测 395px），667px 视口无内部滚动；桌面/平板与其他页面不变                                                                                                                |
| v2.18 | 交易页移动端账户摘要层次化（仅 ≤768px）：摘要段收进整段淡底资产带（`--tb-hover` + `--radius-md`，复用费用预估容器语言，替代顶部结构实线作段分隔）；四指标改居中排版对齐 info-table 移动端 4 列范式，形成「带容器 + 居中指标」两级层次；弹层体 395→408px（375 宽实测），仍在 667px 视口免滚动预算内（上限 443px）；桌面/平板与其他页面不变                                                                                                                  |
| v2.19 | 移除持仓表行内买/卖快捷按钮（删除 `.trade-action-btn`/`.cell-actions` 样式与桌面「操作」列、移动端脚行操作组）：下单统一收敛至委托面板单一入口；§2.2 圆角/999px 用途、§2.7 悬停、§3.7 表内操作按钮、§3.11 脚行描述、§5 触控例外登记同步清理                                                                                                                                                                                                                |
| v2.20 | 成交记录时间粒度改为仅日期：`TradeRecord.ts` 落账时截断至本地日界（不再记时分秒），成交宽表与移动端成交列表时间列同步只显示日期（zh `yyyy/mm/dd` / en `mm/dd/yyyy`）；§3.7 补登记时间列格式                                                                                                                                                                                                                                                                |
| v2.21 | 移动端成交列表主锚点由金额改为已实现盈亏（主行右值，语义色 600/num，买入 `--`），金额降入数据行字段流，成交行去除脚行；§3.11 列表模式描述同步更新（脚行仅持仓使用）                                                                                                                                                                                                                                                                                        |
| v2.22 | 移动端持仓/成交记录卡重设计：双层信息行改**三段式信息卡**——主行（名称 + 盈亏锚点：持仓浮动盈亏/成交已实现盈亏，语义色）、次行（代码 + 元信息：盈亏%/日期）、数据格带（固定 4 列标签上/数值下网格，列间细线），消除字段流换行不齐、卡片高度统一；删除 `list-line-data`/`list-line-foot`/`list-pnl-group`/`list-pnl`/`list-foot-label`，新增 `list-line-sub`/`list-grid`/`list-cell`；§3.11 同步更新                                                         |
| v2.23 | 移动端持仓/成交记录卡再设计（去表格化）：三段式改**回执票据式**——头部双锚点（左身份栈：方向**戳记**淡底胶囊 `--up-bg`/`--tb-active-bg` + 名称 13/600 + 代码；右数字栈：盈亏大数 16/700 语义色 + 元信息（盈亏%/日期））+ 淡底统计带（复用 `.order-estimate` 容器语言，四项 space-between 分散、无分隔线）；新增令牌 `--up-bg`（§2.1），类名换为 `list-head`/`list-id`/`list-hero`/`list-stats`/`list-stat`；§3.11 同步更新                                  |
| v2.24 | 修复主题切换时快捷仓位等按钮底色闪烁：悬停补间 `transition` 会对 CSS 变量换值做 0.2s 渐变、与瞬时切换的表面错拍——`toggleTheme` 切换瞬间在 `#app` 挂 `.theme-switching` 全局抑制过渡（`transition: none !important`），50ms 后移除；§0.7 的 0.2s 交互过渡不受影响                                                                                                                                                                                           |
| v2.25 | 信息架构调整：行情终端自首页整体迁出至 `/dashboard`（内容与行为不变），首页改为入口页（新增 §3.12：`.home-page` 淡底画布 + hero + 双入口卡——行情看板品牌蓝 / 模拟交易买入红）；交易页「返回行情」两处链接改指 `/dashboard`，边界代理（`proxy.ts`）保留段新增 `dashboard`                                                                                                                                                                                   |
| v2.26 | 修复跨页主题不同步：客户端导航不重建根节点、`#app.dark` 随 DOM 带入下一页，但各页 `dark` state 恒从 `false` 起算且图表固定浅色初始化，导致看板/交易页首击开关无效（state 与 DOM 错位）、深色页面挂浅色画布（网格条纹错配）。修复：`#app.dark` 类为**唯一事实源**——`ChartTerminal` 新增 `dark` 初始主题选项（`init` 内 `setStyles('dark')` 后再应用 A 股配色等自定义样式），`useChartTerminal`/`HomeLanding` 的开关一律从 DOM 取反（移除本地 `dark` state） |

## 7. AI 交付前检查清单

- [ ] 未出现任何硬编码 hex/圆角/阴影/字号（`npm run lint:css` 通过；实底白字用 `var(--on-solid)`，语义色派生透明度除外）
- [ ] 数值全部 `var(--font-num)` + `tabular-nums`，数字列右对齐
- [ ] 涨=红 `--up`、跌=绿 `--down`，方向值带符号
- [ ] 深色主题逐项检查（切 `#app.dark` 无肉眼违和、对比度达标）
- [ ] 键盘 Tab 走查：焦点环可见；悬停/选中/禁用态齐全
- [ ] 过渡全部 `0.2s ease`，未过渡宽高；新动画有 `klinecharts-` 前缀且降级生效
- [ ] ≤768px 无横向溢出（表格允许容器内横滚）
- [ ] 文案走 `t()` 双语，无 emoji 图标
- [ ] 新增令牌已在 §2 登记；新组件在 §3 有对应条目或按最近组件类推
