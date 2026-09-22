# 项目规则（Project Rules）

## UI 开发（最高优先级）

1. **任何 UI 新增/修改前，必读 `docs/UI_SPEC.md`** 并逐节遵守；规范未覆盖的场景按"最接近的现有组件"类推，并在规范 §3 补登记后再动手。
2. 颜色语义不可反转：涨/盈利 = `var(--up)`（红），跌/亏损 = `var(--down)`（绿）；动作色：买入 = `var(--up)`（红）、卖出 = `var(--tb-active)`（品牌蓝，UI_SPEC v2.9 起，绿不再用于卖出）——A 股涨跌惯例，与 `src/lib/chart/constants.ts` 的 K 线配色联动。
3. 组件样式禁止硬编码：颜色/圆角/阴影/字号一律引用 `src/app/globals.css` 顶部的**设计令牌**；实底（语义色/主色）上的文字与纯白装饰件用 `var(--on-solid)`。
4. 一切数值（价格/金额/百分比/股票代码）必须 `font-family: var(--font-num)` + `font-variant-numeric: tabular-nums`，数字列右对齐（`.num`）。
5. 样式只写 `src/app/globals.css`（选择器带 `#app` 前缀），禁止内联样式、新建 CSS 文件、CSS-in-JS。
6. 深浅双主题必须同时可用（深色 = `#app.dark` 切换变量值），正文对比度 ≥ 4.5:1。
7. `npm run lint:css`（stylelint）会拦截组件区硬编码 hex、阶外圆角与非令牌字族；新增令牌必须先在 `docs/UI_SPEC.md` §2 登记再使用。
8. 交互过渡统一 `0.2s ease`（只过渡颜色/阴影/透明度类属性）；文案一律 `t('中文|English')`；图标用内联 SVG，禁止 emoji。
9. 交付前过一遍 `docs/UI_SPEC.md` §7 检查清单。

## 其它约定

- 代码风格：ESLint + Prettier（`npm run lint` / `npm run format`），提交走 commitlint 规范（conventional commits）。
- 架构与目录说明见 `docs/ARCHITECTURE.md`、`docs/DIRECTORY.md`。
