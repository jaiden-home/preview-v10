# UI 规范（Design Spec）

当前生效版本：**Soft UI Evolution（金融终端）**，深浅双主题，A 股语义配色（红涨绿跌）。
行情页（TradingTerminal）与交易页（PaperTrading）均已按本规范实现，作为视觉基准。

> 本文件是 AI / 开发者创建或修改页面的**唯一视觉依据**：所有新增样式必须遵循本规范；
> 如需引入新令牌（Token），必须先在 §2 登记再使用；规范未覆盖的场景，按"最接近的现有组件"类推。

## 0. AI 建页强制规则（先读这一节）

1. **配色语义不可反转**：涨/盈亏/买入 = `var(--up)` 红；跌/亏损/卖出 = `var(--down)` 绿。禁止绿涨红跌（那是欧美惯例，本项目是 A 股语义，且与 K 线图 `constants.ts` 的 `CN_UP_COLOR/CN_DOWN_COLOR` 联动）。
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

| 约定         | 说明                                                                                                                                  |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| 样式方案     | 纯全局 CSS，单一文件 `src/app/globals.css`                                                                                            |
| 命名空间     | 所有选择器带 `#app` 前缀（`layout.tsx` 的 `<div id="app">` 提供隔离）                                                                 |
| 主题机制     | 深色 = 根节点 `#app.dark`，仅切换 CSS 变量值，不改结构                                                                                |
| 图表内部样式 | klinecharts 画布内（轴/蜡烛/指标）由 `src/lib/chart/terminal.ts` 管理，颜色常量在 `src/lib/chart/constants.ts`，CSS 不干预            |
| 页面骨架     | `#app`（100vh 纵向 flex）→ 顶部 `.toolbar` → 页面内容。卡片化页面（如交易页）内容包一层 `.trade-page`（淡色底 `--page-tint`）衬托卡片 |
| 布局单位     | 间距以 2px 为基进位（2/3/4/6/8/10/12/14/16/18）；页面级栅格 gap 与 padding = `12px`（移动端 `8px`）                                   |

## 2. 设计令牌（Design Tokens）

变量定义于 `#app`（浅色）与 `#app.dark`（深色）。**组件里只允许引用变量名。**

### 2.1 颜色

| 变量             | 浅色值                | 深色值                | 用途                                 |
| ---------------- | --------------------- | --------------------- | ------------------------------------ |
| `--bg`           | `#ffffff`             | `#121212`             | 页面根背景（终端页）                 |
| `--page-tint`    | `#eef1f6`             | `#0e1219`             | 卡片化页面画布底（交易页）           |
| `--tb-bg`        | `#ffffff`             | `#1c212b`             | 工具栏/卡片/表格/输入框背景          |
| `--tb-text`      | `#1f2733`             | `#dde3ee`             | 主文本                               |
| `--tb-text-sub`  | `#5c6779`             | `#98a2b3`             | 次要文本（标签、提示、表头）         |
| `--tb-border`    | `#e5e9f0`             | `#2a3140`             | 结构性边框（实线）                   |
| `--tb-hover`     | `#f1f4f9`             | `#262d3a`             | 悬停底色/弱底色容器                  |
| `--tb-active`    | `#1677ff`             | `#3c82f7`             | 强调色（选中、聚焦、品牌蓝）         |
| `--tb-active-bg` | `rgba(22,119,255,.1)` | `rgba(22,119,255,.2)` | 选中浅底/输入聚焦光环                |
| `--dropdown-bg`  | `#ffffff`             | `#1c212b`             | 下拉/弹窗背景                        |
| `--chart-grid`   | `#ededed`             | `#292929`             | 图表网格线/图表邻接虚线              |
| `--up`           | `#ef2323`             | `#ef2323`             | 涨/盈亏为正/买入（红，深浅共用）     |
| `--down`         | `#14a143`             | `#14a143`             | 跌/亏损/卖出（绿，深浅共用）         |
| `--on-solid`     | `#ffffff`             | `#ffffff`             | 实底上的文字与纯白装饰件（深浅共用） |

### 2.2 圆角（令牌化，禁止阶外圆角）

| 令牌          | 值      | 用途                                                     |
| ------------- | ------- | -------------------------------------------------------- |
| `--radius-sm` | `8px`   | 按钮、输入框、下拉项、表内操作按钮容器                   |
| `--radius-md` | `10px`  | 下拉面板、Toast、预估区、买卖分段容器、提交按钮          |
| `--radius-lg` | `12px`  | 卡片（`.trade-card`/`.trade-summary`）、弹窗             |
| （字面量）    | `6px`   | 分段控件内部按钮（比容器小一档），stylelint 白名单已登记 |
| （字面量）    | `50%`   | 圆形（主题开关滑块、脉冲圆点、清空按钮）                 |
| （字面量）    | `999px` | 胶囊（主题开关轨道、表内买/卖操作按钮）                  |
| （字面量）    | `0`     | 组合角（如 tab 顶部圆角 `var() var() 0 0`）              |

### 2.3 阴影（柔和双层，Soft UI 核心）

| 令牌            | 浅色值                                                          | 深色值（自动切换）                                      | 用途                    |
| --------------- | --------------------------------------------------------------- | ------------------------------------------------------- | ----------------------- |
| `--shadow-card` | `0 1px 2px rgba(15,23,42,.04), 0 4px 12px rgba(15,23,42,.06)`   | `0 1px 2px rgba(0,0,0,.28), 0 6px 16px rgba(0,0,0,.34)` | 静止卡片                |
| `--shadow-pop`  | `0 4px 10px rgba(15,23,42,.08), 0 12px 32px rgba(15,23,42,.14)` | `0 8px 24px rgba(0,0,0,.5), 0 16px 40px rgba(0,0,0,.4)` | 浮层（下拉/弹窗/Toast） |

语义色投影（仅限实底 CTA / 分段选中态，`0 2px 8px`）：

- 买/涨：`box-shadow: 0 2px 8px rgba(239,35,35,.28)`
- 卖/跌：`box-shadow: 0 2px 8px rgba(20,161,67,.28)`

### 2.4 字体

| 令牌          | 值                                                                                                              | 用途           |
| ------------- | --------------------------------------------------------------------------------------------------------------- | -------------- |
| `--font-sans` | `Inter, -apple-system, 'Segoe UI', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', system-ui, sans-serif` | 正文/标题/标签 |
| `--font-num`  | `'SF Mono', 'Cascadia Mono', 'JetBrains Mono', Menlo, Consolas, 'Roboto Mono', 'Courier New', monospace`        | 一切数值与代码 |

规则：全局行高 `1.5`（紧凑单元格 `1.3`）；数值必须 `font-family: var(--font-num)` + `font-variant-numeric: tabular-nums`；渲染 `antialiased`、`font-synthesis: none`。

### 2.5 字号阶梯（7 级，禁止阶外字号）

| 级别      | 字号/字重        | 字族 | 用途（示例类）                                                              |
| --------- | ---------------- | ---- | --------------------------------------------------------------------------- |
| Display   | `26px / 700`     | num  | 总资产 `.summary-total`                                                     |
| Display-S | `22px / 700`     | num  | 委托现价 `.order-price`                                                     |
| CTA       | `14px / 600~700` | —    | 提交按钮 `.order-submit`(700)、统计值 `.stat-value`(600, num)               |
| Title     | `13px / 600`     | —    | 弹窗标题、`.order-name`、Toast、加载文案                                    |
| Base      | `12px / 400~600` | —    | 工具栏按钮、表格正文、表单标签、预估区                                      |
| Secondary | `11px / 400~600` | num* | 表头 `th`、`.order-hint`、`.order-avail`、`.info-value`(600, num)、紧凑按钮 |
| Micro     | `10px / 400`     | —    | `.stat-label`、`.info-label`、`.cell-code`(num)                             |

`num*`：凡内容为数字/代码即套等宽字族，与级别无关。

### 2.6 边框规则

| 类型         | 值                                                    | 用途                                                                 |
| ------------ | ----------------------------------------------------- | -------------------------------------------------------------------- |
| 结构实线     | `1px solid var(--tb-border)`                          | toolbar 底边、卡片描边、th 底边、tab 栏底边、hero 与栅格之间的竖分隔 |
| 图表邻接虚线 | `1px dashed var(--chart-grid)`                        | 与图表衔接的分隔（info-table 底边、order-head 底边）                 |
| 输入框描边   | `1px solid var(--tb-border)`                          | 聚焦见 §2.8                                                          |
| 分隔线       | 宽 `1px` 高 `16px`，`margin: 0 8px`，色 `--tb-border` | 工具栏 `.tb-divider`                                                 |

### 2.7 间距

| 场景       | 值                                                                         |
| ---------- | -------------------------------------------------------------------------- |
| 工具栏容器 | `padding: 8px 12px`，控件 `gap: 2px`（含卡片内工具栏）                     |
| 面板/卡片  | 卡片内边距 `14px 16px`，面板纵向 `gap: 12px`                               |
| 页面栅格   | `gap: 12px; padding: 12px`（移动端 `8px`）；主卡边距 `margin: 12px 12px 0` |
| 统计单元格 | `padding: 2px 18px`，`min-width: 128px`，标签/数值 `gap: 3px`              |
| 信息单元格 | `padding: 4px 6px`，`gap: 2px`                                             |
| 数据表格   | 单元格 `padding: 10px 14px`（th 同款）                                     |
| 弹窗       | 头/体/尾 `padding: 12px 16px`                                              |
| 下拉面板   | `padding: 6px`，选项 `padding: 5px 6px`                                    |

### 2.8 交互反馈

| 状态     | 规则                                                                                                                                                    |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 过渡     | `0.2s ease`；属性限 `background-color / color / border-color / box-shadow / filter / opacity`                                                           |
| 键盘焦点 | 全局 `:focus-visible`：`outline: 2px solid var(--tb-active); outline-offset: 2px`（已内置，勿删）                                                       |
| 输入聚焦 | `border-color: var(--tb-active)` + `box-shadow: 0 0 0 3px var(--tb-active-bg)`；checkbox `accent-color: var(--tb-active)`                               |
| 悬停     | 按钮/表格行：底色 `var(--tb-hover)`；表内操作按钮：语义色描边 + 8% 语义色底（行悬停已占用底色）                                                         |
| 选中     | 工具栏按钮：`--tb-active` 文 + `--tb-active-bg` 底 + 600 字重；分段选中：白字 + `--tb-active` 实底；买/卖选中：白字 + `--up`/`--down` 实底 + 语义色投影 |
| 禁用     | `opacity: 0.5; cursor: not-allowed`                                                                                                                     |
| 降级     | `prefers-reduced-motion: reduce` 时全局动画/过渡归零（已内置）                                                                                          |
| 滚动条   | 细滚动条（8px、胶囊 thumb `--tb-border`，悬停 `--tb-text-sub`，track 透明；Firefox `scrollbar-width: thin`），随主题切换                                |
| 选区     | `::selection` = `--tb-active` 底 + `var(--on-solid)` 字                                                                                                 |

## 3. 组件规范

### 3.1 页面骨架与卡片

- 卡片化页面（交易页）：内容包 `.trade-page`（`flex: 1; min-height: 0; flex-column; background: var(--page-tint)`），卡片浮于其上。
- 卡片 `.trade-card`：`--tb-bg` + `1px solid --tb-border` + `--radius-lg` + `var(--shadow-card)`。卡片内首行若是工具栏，底部加结构实线。
- 终端页（行情页）不铺卡片，保持通栏：toolbar → info-table → 图表。

### 3.2 总资产主卡（.trade-summary，数据卡片范式）

结构：`summary-hero`（左）+ `summary-grid`（中）+ `stat-reset`（右）。

- 容器：卡片规格（§3.1）+ `margin: 12px 12px 0; padding: 14px 18px`。
- `summary-hero`：`min-width: 200px`，右侧 `1px` 竖分隔线；上 Micro 标签、中 Display 总额、下 Secondary 总盈亏（`summary-pnl` 套 `up/down/flat`）。
- `summary-grid`：flex wrap，内放 `stat-cell`（上标签下数值，见 §2.5/§2.7）。
- `stat-reset`：`margin-left: auto`，右对齐，标签在上、按钮在下。
- 任何"关键指标卡"（账户/策略/组合）复用此范式：hero 放主指标，grid 放次指标。

### 3.3 工具栏（.toolbar / .trade-chart-toolbar）

- 横向 flex、可换行、`gap: 2px`、`padding: 8px 12px`、背景 `--tb-bg`、底部结构实线。
- `.tb-btn`：`12px`、`padding: 5px 10px`、圆角 `--radius-sm`、透明底。
- 主操作（`.tb-symbol`）：600 字重 + `--tb-active` 文 + `--tb-active-bg` 胶囊。
- 幽灵按钮（`.tb-clear`）：次要色文字，悬停恢复主文本色。
- 分段控件 `.period-group`：容器 `padding: 2px` + `--tb-hover` 底 + `--radius-sm`；内部按钮 `padding: 2px 10px` 圆角 `6px`。
- 主题开关推至最右（`margin-left: auto`）；卡片内工具栏需覆盖该规则。

### 3.4 输入框（标准规格）

`font-family: var(--font-num); font-size: 13px; padding: 8px 10px; border: 1px solid var(--tb-border); border-radius: var(--radius-sm); background: var(--tb-bg)`，聚焦按 §2.8。适用于搜索框、参数输入、委托价格/数量输入。

### 3.5 下拉面板与弹窗

- 下拉：`--dropdown-bg` + `1px --tb-border` + `--radius-md` + `var(--shadow-pop)`，距按钮 `6px`；选项 `.tb-btn`/`.check-row`。
- 弹窗：宽 `320px`、`--radius-lg` + `var(--shadow-pop)`；标题 Title 级；页脚主按钮 `--tb-active` 实底。

### 3.6 信息表格（.info-table）

8 列网格（移动端 4 列），字号 `11px`；仅保留下边框（图表邻接虚线）；单元格上标签（Micro）下数值（Secondary/600/num），居中。卡片内使用时同样只留下边框。

### 3.7 数据表格与标签页

- `.trade-table`：正文 Base `12px`、th Secondary `11px/500` + `letter-spacing: .02em`、单元格 `10px 14px`、行悬停 `--tb-hover`（行加 `0.2s` 过渡）。
- 数字列 `.num` 右对齐 + 等宽字族；标的列 `.cell-symbol` 上名称（600）下代码（Micro/num）。
- 方向语义：`up/down/flat` 类（`--up/--down/--tb-text`），涨跌值与现价都要套。
- 表内操作按钮：胶囊（`999px`，`padding: 5px 14px`，600 字重），买 `--up`/卖 `--down` 描边 + 悬停 8% 语义色底。
- 标签行 `.trade-tabs`：复用 `.tb-btn`，容器 `padding: 8px 12px 0` + 底部结构实线，选中态同工具栏按钮。

### 3.8 委托面板（.order-panel）

- 头部：名称 Title + 代码 Secondary；现价 Display-S + 涨跌 Secondary，红涨绿跌；底部图表邻接虚线。
- 买卖切换：分段容器（`--tb-hover` 底 + `--radius-md` + `padding: 3px`），`.side-btn` `12px/600; padding: 7px 0` 透明底，选中语义色实底白字 + 语义色投影。
- 快捷仓位按钮（25%/50%/全仓…）：Secondary/num 紧凑按钮，`--tb-hover` 底 + `--radius-sm`，悬停换 `--tb-border` 底。
- 费用预估 `.order-estimate`：`--tb-hover` 底 + `--radius-md` + num。
- 提交 `.order-submit`：CTA `14px/700; padding: 11px 0; --radius-md`，买 `--up` 卖 `--down` + 语义色投影，悬停 `brightness(1.06)`。

### 3.9 Toast 与加载

- Toast：底部居中悬浮，`role="status"` + 状态图标（成功 ✓ / 失败 ✗，内联 SVG 14px，`currentColor`）+ Title 白字，`--radius-md` + `var(--shadow-pop)`，成功 `--down` / 失败 `--up`，`0.2s ease` 入场，3s 自动消隐。
- 加载：文案居中（`.trade-loading`）或脉冲圆点（`.fundamental-loading`，`@keyframes` 前缀 `klinecharts-`）。

### 3.10 空状态（.trade-empty / .order-untradable 范式）

结构：内联 SVG 图标（36px、`stroke: currentColor`、容器色 `var(--tb-border)`）+ 主文案 `.trade-empty-title`（Title 级主文本色）+ 副文案 `.trade-empty-sub`（Secondary 次要色，引导下一步操作），纵向居中，`padding: 40px 16px 36px`。

- 适用：持仓空态、成交记录空态、委托面板不可交易提示（`.order-untradable`，图标 32px + 单句文案）。
- 新增空状态一律复用此范式，图标必须内联 SVG（`aria-hidden`），禁止纯文字或 emoji。

## 4. 响应式断点

- 平板（769–1024px）：交易页委托面板收窄至 `320px`，汇总卡 hero `min-width: 160px`，统计单元格 `min-width: 0`。
- 移动端（≤768px）：
  - 工具栏：`gap: 6px; padding: 6px 8px`，隐藏分隔线，按钮整行等宽，标的按钮占满首行。
  - 信息表格降 4 列 `10px`；下拉右对齐防溢出。
  - 交易页：主卡转纵向（hero 通栏 + 底部分隔线，栅格 2 列）；页面栅格转纵向 flex，`padding: 8px`，图表卡固定 `360px` 高。

## 5. 无障碍基线

- 正文对比度 ≥ 4.5:1（当前令牌浅/深两套均达标，改令牌时必须复核）。
- 全局焦点环、`cursor: pointer`、`prefers-reduced-motion` 见 §2.8，禁止局部删除。
- 图标禁止无标签裸按钮（icon-only 必须带 `aria-label`）；涨跌不允许只靠颜色表达，需伴随 +/- 号或文字（现有 `fmtSignedMoney`/`fmtPct` 已保证）。
- 触控目标：主要操作 ≥ 40px 高；表内紧凑操作按钮为例外，但已放大到 `5px 14px`。

## 6. 变更记录

| 版本 | 变更                                                                                                                                                                                       |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| v1   | 交易页对齐行情页：统一令牌、涨跌语义色去硬编码、过渡与禁用态补齐                                                                                                                           |
| v2   | Soft UI Evolution 改版：圆角/阴影/字族令牌化（8/10/12px + 双层阴影 + 等宽数字）、总资产主卡、分段控件、胶囊操作按钮、交易页淡色画布、全局焦点环与动效降级                                  |
| v2.1 | 规范工程化：新增 `--on-solid` 令牌（组件区 hex 清零）、stylelint 强制（`lint:css`，pre-commit/CI 接入）、Trae 项目规则入口 `.trae/rules/project_rules.md`、遗留 4px 圆角统一 `--radius-sm` |
| v2.2 | 体验细化（当前）：滚动条/选区主题化、平板断点（769–1024px）、空状态范式（§3.10，图标+主副文案）、Toast 状态图标 + `role="status"`                                                          |

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
