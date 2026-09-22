# AGENTS.md

AI coding agent 项目指引（Trae / Claude Code / Codex 等通用）。详细规范见 `docs/`；与本文件或 `.trae/rules/project_rules.md` 冲突时，以后两者为准。

## 项目

A 股行情预览 + 模拟交易的 Web 终端：Next.js 16（App Router，standalone）+ React 19 + klinecharts v10（Canvas 图表，仅客户端）+ 腾讯行情 BFF。深浅双主题，中英双语（`t('中文|English')`）。

## 常用命令

| 任务     | 命令                                                                     |
| -------- | ------------------------------------------------------------------------ |
| 本地开发 | `npm run dev`（3000 被占用时自动换 3001）                                |
| 构建     | `npm run build`                                                          |
| Lint     | `npm run lint`（ESLint）· `npm run lint:css`（stylelint，UI 令牌强约束） |
| 类型检查 | `npm run typecheck`（tsc strict）                                        |
| 单元测试 | `npm run test`（Vitest，`*.test.ts` 与源码同目录）                       |
| E2E      | `npm run test:e2e`（Playwright）                                         |

**交付门槛**：`build` + `typecheck` + `lint` + `lint:css` 四项全绿；涉及业务逻辑的改动必须补/改测试；UI 改动另过 `docs/UI_SPEC.md` §7 检查清单。

## 代码结构（src/）

- `app/`：路由层。`page.tsx` 首页（默认上证指数的行情终端）、`trade/` 模拟交易页、`api/` BFF 五接口（kline / timeshare / quote / search / healthz）、`globals.css` **唯一样式文件**。
- `components/terminal/`：行情终端组件（`TradingTerminal` 及工具栏 / 信息表格 / 指标弹窗，图表生命周期统一在 `useChartTerminal`）。
- `components/trading/`：模拟交易组件（`PaperTrading` / `TradeSummary` / `OrderPanel` / `PositionsTable` / `TradesTable`）。
- `lib/chart/`：环境无关的图表域逻辑（`ChartTerminal` 命令式控制器、`DataLoader`、分时状态机、纯函数及测试）。对 klinecharts 一律动态 `import()`，**禁止进入服务端模块图**。
- `lib/server/`：仅服务端（`market-service` 数据源编排、`provider/tencent` 腾讯实现、TTLCache、限流、zod、pino），禁止被客户端引用。
- `lib/trading/account.ts`：模拟交易纯函数（整手买入、T+1、涨跌停、佣金/印花税），带测试。
- `proxy.ts` / `instrumentation*.ts`：边缘 404 与 `x-request-id` 注入、启动日志与优雅停机。

## 必读文档（按任务选读）

| 场景                            | 文档                                                                 |
| ------------------------------- | -------------------------------------------------------------------- |
| 任何 UI 新增/修改（必读）       | `.trae/rules/project_rules.md` → `docs/UI_SPEC.md`（令牌/组件/清单） |
| 架构与机制（SSR/BFF/分时/缓存） | `docs/ARCHITECTURE.md`                                               |
| 目录职责明细                    | `docs/DIRECTORY.md`                                                  |

注：`ARCHITECTURE.md` 中描述的 `[symbol]` 动态路由已不在当前代码中，以 `app/` 实际路由为准。

## 硬性约束（违反即返工）

1. **红涨绿跌**（A 股语义，不可反转）：涨/盈利/买入 = `var(--up)`（红），跌/亏损/卖出 = `var(--down)`（绿），与 `lib/chart/constants.ts` 的 K 线配色联动。
2. **样式令牌制**：颜色/圆角/阴影/字族只引用 `globals.css` 顶部设计令牌；`lint:css` 会拦截组件区硬编码 hex、阶外圆角与非令牌字族；新增令牌先在 `docs/UI_SPEC.md` §2 登记。
3. **数值排版**：金额/价格/百分比/股票代码必须 `font-family: var(--font-num)` + `font-variant-numeric: tabular-nums`，数字列右对齐（`.num`）。
4. **图表不参与 SSR**：klinecharts 只能动态 `import()`；服务端渲染外壳（工具栏 + 信息表格）与数据。
5. **CSS 命名空间**：选择器一律 `#app` 前缀；禁止内联样式、新建 CSS 文件、CSS-in-JS。
6. **深浅双主题**：深色 = `#app.dark` 仅切变量值；两主题必须同时验收，正文对比度 ≥ 4.5:1。
7. **交互与文案**：过渡统一 `0.2s ease`（只过渡颜色/阴影/透明度类属性）；图标内联 SVG（禁 emoji）；文案一律 `t('中文|English')`。
8. **UI 优化 ≠ 功能变更**：样式/标记结构调整不得改动业务逻辑、数据流与交互行为。

## 提交

Conventional Commits（commitlint + husky 强制）；pre-commit 对暂存文件自动执行 ESLint / Prettier / stylelint。
