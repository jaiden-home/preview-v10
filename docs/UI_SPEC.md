# UI 规范（Design Spec）

以**行情页（TradingTerminal）为视觉基准**，交易页（PaperTrading）已按本规范对齐。
所有页面/组件的新增与修改样式必须遵循本规范；如需引入新令牌（Token），先在本文件登记再使用。

## 1. 总则与实现约定

| 约定         | 说明                                                                                                                     |
| ------------ | ------------------------------------------------------------------------------------------------------------------------ |
| 样式方案     | 纯全局 CSS，单一文件 `src/app/globals.css`，禁止内联样式（动态颜色除外，如 `InfoTable` 数值涨跌色）                      |
| 命名空间     | 所有选择器必须带 `#app` 前缀（`layout.tsx` 中 `<div id="app">` 提供隔离）                                                |
| 主题机制     | 深色主题 = 根节点追加 `dark` 类（`#app.dark`），仅切换 CSS 变量值，不改结构                                              |
| 图表内部样式 | 坐标轴/蜡烛/指标线由 `src/lib/chart/terminal.ts` 经 klinecharts styles API 管理，颜色常量见 `src/lib/chart/constants.ts` |
| 双语         | 文案经 `t('中文                                                                                                          | English')`，字号按中文宽度设计，禁止因英文截断换行 |

## 2. 设计令牌（Design Tokens）

### 2.1 颜色（语义变量）

变量定义于 `#app`（浅色）与 `#app.dark`（深色）：

| 变量             | 浅色值                | 深色值                | 用途                         |
| ---------------- | --------------------- | --------------------- | ---------------------------- |
| `--bg`           | `#ffffff`             | `#121212`             | 页面背景                     |
| `--tb-bg`        | `#ffffff`             | `#1e2126`             | 工具栏/卡片/表格背景         |
| `--tb-text`      | `#293252`             | `#d1d4dc`             | 主文本                       |
| `--tb-text-sub`  | `#76808f`             | `#86898f`             | 次要文本（标签、提示）       |
| `--tb-border`    | `#ebedf1`             | `#2a2e35`             | 结构性边框（实线）           |
| `--tb-hover`     | `#f2f3f5`             | `#2a2e35`             | 悬停底色/弱底色容器          |
| `--tb-active`    | `#1677ff`             | `#3c82f7`             | 强调色（选中、聚焦、品牌蓝） |
| `--tb-active-bg` | `rgba(22,119,255,.1)` | `rgba(22,119,255,.2)` | 选中态浅底                   |
| `--dropdown-bg`  | `#ffffff`             | `#1e2126`             | 下拉/弹窗背景                |
| `--chart-grid`   | `#ededed`             | `#292929`             | 图表网格线/图表邻接虚线      |
| `--up`           | `#ef2323`             | `#ef2323`             | 涨/买入（红，深浅共用）      |
| `--down`         | `#14a143`             | `#14a143`             | 跌/卖出（绿，深浅共用）      |

规则：

- 禁止在组件/CSS 中硬编码颜色，一律引用变量；`--up/--down` 与 `constants.ts` 的 `CN_UP_COLOR/CN_DOWN_COLOR` 保持一致（A 股红涨绿跌）。
- 白色文字写 `#ffffff`（选中实底/主按钮上）。
- 半透明语义描边允许由 `--up/--down` 派生，如 `rgba(239,35,35,.45)`。

### 2.2 字体

| 项       | 值                                                            |
| -------- | ------------------------------------------------------------- |
| 字族     | `Inter, system-ui, Avenir, Helvetica, Arial, sans-serif`      |
| 全局行高 | `1.5`；紧凑单元格（info-cell）`1.3`                           |
| 数字排版 | 所有数值必须 `font-variant-numeric: tabular-nums`             |
| 渲染     | `-webkit-font-smoothing: antialiased`，`font-synthesis: none` |

### 2.3 字号阶梯（6 级，禁止出现阶外字号）

| 级别      | 字号/字重        | 用途（示例类）                                                                                                               |
| --------- | ---------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Display   | `20px / 700`     | 委托面板现价 `.order-price`                                                                                                  |
| CTA       | `14px / 600`     | 提交按钮 `.order-submit`                                                                                                     |
| Title     | `13px / 600`     | 弹窗标题 `.modal-title`、面板标题 `.order-name`、统计值 `.stat-value`、Toast、加载文案                                       |
| Base      | `12px / 400~600` | 工具栏按钮 `.tb-btn`、输入框、数据表正文、表单标签 `.order-field-label`、预估区 `.order-estimate`                            |
| Secondary | `11px / 400~500` | 信息表数值 `.info-value`、表头 `th`、提示 `.order-hint`、`.order-avail`、副标识 `.order-code`、紧凑按钮（快捷/表格操作按钮） |
| Micro     | `10px / 400`     | 微标签 `.info-label`、`.stat-label`、表格内代码 `.cell-code`、下拉箭头                                                       |

### 2.4 圆角阶梯

| 圆角    | 用途                                                                        |
| ------- | --------------------------------------------------------------------------- |
| `4px`   | 按钮、输入框、下拉项、check-row、紧凑操作按钮                               |
| `6px`   | 分段控件容器（period-group）、下拉面板、Toast、买卖切换 `.side-btn`、预估区 |
| `8px`   | 弹窗 `.modal`、交易页卡片 `.trade-card`                                     |
| `999px` | 圆形/胶囊（主题开关轨道）                                                   |

### 2.5 边框规则

| 类型         | 值                                                    | 用途                                                                   |
| ------------ | ----------------------------------------------------- | ---------------------------------------------------------------------- |
| 结构实线     | `1px solid var(--tb-border)`                          | 区块分隔（toolbar 底边、th 底边、卡片描边、tab 栏底边、汇总条顶边）    |
| 图表邻接虚线 | `1px dashed var(--chart-grid)`                        | 与图表衔接的分隔（info-table 底边、order-head 底边），视觉延续图内网格 |
| 输入框描边   | `1px solid var(--tb-border)`，聚焦变 `--tb-active`    | 所有输入框                                                             |
| 分隔线       | 宽 `1px` 高 `16px`，`margin: 0 8px`，色 `--tb-border` | 工具栏 `.tb-divider`                                                   |

### 2.6 间距

| 场景       | 值                                                                           |
| ---------- | ---------------------------------------------------------------------------- |
| 工具栏容器 | `padding: 6px 10px`，控件间 `gap: 2px`（含交易页图表卡内工具栏）             |
| 面板容器   | 卡片内边距 `12px 14px`，面板内纵向 `gap: 10px`                               |
| 页面网格   | `gap: 10px; padding: 10px`（移动端 `padding: 8px`）                          |
| 信息单元格 | `padding: 4px 6px`，标签/数值 `gap: 2px`（统计条 stat-cell 同为 `gap: 2px`） |
| 数据表格   | 单元格 `padding: 8px 12px`，th 同款                                          |
| 弹窗       | 头/体/尾 `padding: 12px 16px`，参数行 `gap: 12px`                            |
| 下拉面板   | `padding: 6px`，选项 `padding: 5px 6px`                                      |

### 2.7 交互反馈

| 状态 | 规则                                                                                                                                                |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| 过渡 | `0.15s ease`，仅过渡 `background-color / color / border-color / filter / opacity`（图表开关类 0.2s）                                                |
| 悬停 | 按钮：底色 `var(--tb-hover)`；输入框：不变（聚焦才反馈）；表格行：底色 `var(--tb-hover)`；表格内操作按钮：边框变为语义色（行悬停已占用底色）        |
| 选中 | 工具栏按钮：`--tb-active` 文字 + `--tb-active-bg` 底 + 600 字重；分段控件选中：白字 + `--tb-active` 实底；买卖切换选中：白字 + `--up`/`--down` 实底 |
| 聚焦 | 输入框 `border-color: var(--tb-active)`；checkbox `accent-color: var(--tb-active)`                                                                  |
| 禁用 | 统一 `opacity: 0.5; cursor: not-allowed`                                                                                                            |
| 阴影 | 下拉 `0 4px 14px rgba(0,0,0,.14)`；弹窗 `0 8px 30px rgba(0,0,0,.25)`；滑块 `0 1px 3px rgba(0,0,0,.3)`                                               |

## 3. 组件规范

### 3.1 工具栏（.toolbar / .trade-chart-toolbar）

- 横向 flex、可换行、`gap: 2px`、`padding: 6px 10px`、背景 `--tb-bg`。
- 常驻按钮 `.tb-btn`：`12px`、`padding: 4px 10px`、圆角 `4px`、无边框透明底。
- 主操作（标的选择 `.tb-symbol`）：600 字重 + `--tb-active` 文字 + `--tb-active-bg` 胶囊。
- 幽灵按钮（返回/清除/重置 `.tb-clear`）：`--tb-text-sub` 文字，悬停恢复主文本色。
- 分段控件 `.period-group`：容器 `padding: 2px` + `--tb-hover` 底 + 圆角 `6px`；内部按钮 `padding: 2px 10px`。
- 主题开关推至最右（`margin-left: auto`）；卡片内工具栏需覆盖该规则。

### 3.2 输入框（标准规格）

`font-size: 12px; padding: 6px 8px; border: 1px solid var(--tb-border); border-radius: 4px; background: transparent`，聚焦边框 `--tb-active`。适用于搜索框、参数输入、委托价格/数量输入（`.symbol-search-input / .param-input / .order-input`）。

### 3.3 下拉面板与弹窗

- 下拉：`--dropdown-bg` + `1px --tb-border` + 圆角 `6px` + 阴影，距按钮 `6px`；选项用 `.tb-btn`/`.check-row`（`12px`）。
- 弹窗：宽 `320px`、圆角 `8px`；标题 `13px/600`；页脚按钮主色实底（`.modal-btn.primary`）。

### 3.4 信息表格与统计条

- `.info-table`：8 列网格（移动端 4 列），字号 `11px`，上边框实线、下边框虚线（`--chart-grid`）；卡片内去掉重复上边框。
- 单元格上标签（Micro `10px`）下数值（Secondary + 600 字重），居中。
- `.trade-summary` 统计条：同「上标签下数值」结构，数值 Title 级 `13px/600`，`tabular-nums`。

### 3.5 卡片（交易页 .trade-card）

`--tb-bg` 背景 + `1px solid --tb-border` + 圆角 `8px`。内部工具栏底部加结构实线。

### 3.6 数据表格与标签页

- `.trade-table`：正文 `12px`、th `11px/500/次要色`、单元格 `8px 12px`、行悬停 `--tb-hover`；数字列右对齐（`.num`）+ `tabular-nums`。
- 标签行 `.trade-tabs`：复用 `.tb-btn`（选中态同工具栏按钮），容器 `padding: 6px 10px 0` + 底部结构实线。
- 涨跌/买卖方向：`up/down/flat` 类（`--up/--down/--tb-text`）。

### 3.7 委托面板（.order-panel）

- 头部：名称 Title 级 + 代码 Secondary；现价 Display 级 + 涨跌 Secondary，红涨绿跌；底部图表邻接虚线。
- 买卖切换 `.side-btn`：Base `12px/600`，`padding: 7px 0`，圆角 `6px`，默认 `--tb-hover` 底 + 次要色文字，选中语义色实底白字。
- 表单：标签 Base 级次要色（右侧可带提示），输入框按 §3.2 标准规格；快捷按钮（25%/50%…）为 Secondary 级紧凑按钮（`--tb-hover` 底）。
- 费用预估 `.order-estimate`：`--tb-hover` 底 + 圆角 `6px` + `12px`。
- 提交 `.order-submit`：CTA `14px/600`，`padding: 10px 0`，圆角 `6px`，买 `--up` 卖 `--down`，悬停 `brightness(1.06)`。

### 3.8 Toast

底部居中悬浮，`13px` 白字，圆角 `6px`，成功 `--down` / 失败 `--up`，`0.2s ease` 入场，3s 自动消隐。

## 4. 移动端（≤768px）

- 工具栏：`gap: 6px; padding: 6px 8px`，隐藏分隔线，按钮整行等宽；标的按钮占满首行。
- 信息表格降为 4 列 `10px`；交易网格降为纵向 flex，`padding: 8px`，图表卡固定 `360px` 高。
- 汇总条降为 2 列网格；下拉面板右对齐防溢出。

## 5. 本次交易页对齐记录（基准：行情页）

| 项                            | 原值                                  | 对齐后                                                  |
| ----------------------------- | ------------------------------------- | ------------------------------------------------------- |
| `.trade-chart-toolbar` 内边距 | `4px 10px`                            | `6px 10px`                                              |
| `.order-input` 字号/内边距    | `13px / 7px 10px`                     | `12px / 6px 8px`                                        |
| `.side-btn` 字号              | `13px`                                | `12px`                                                  |
| `.order-name` 字号            | `14px`                                | `13px`                                                  |
| `.order-field-label` 字号     | `11px`                                | `12px`                                                  |
| `.stat-cell` 标签/数值间距    | `1px`                                 | `2px`                                                   |
| 涨跌/买卖语义色               | 9 处硬编码 hex                        | 统一 `var(--up)/var(--down)`（新增令牌）                |
| `.trade-action-btn`           | 无过渡、无悬停反馈、禁用 `opacity .4` | 补 `0.15s` 过渡 + 悬停语义色描边，禁用统一 `opacity .5` |
