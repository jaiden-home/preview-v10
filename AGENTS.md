# AGENTS.md

AI coding agent 项目指引（Trae / Claude Code / Codex 等通用）。详细规范见 `docs/`；与本文件或 `.trae/rules/project_rules.md` 冲突时，以后两者为准。

## 项目

A 股行情预览 + 模拟交易的 Web 终端：Next.js 16（App Router，standalone）+ React 19 + klinecharts v10（Canvas 图表，仅客户端）+ 腾讯行情 BFF。深浅双主题，中英双语（`t('中文|English')`）。

## 常用命令

| 任务     | 命令                                                                                                                                                     |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 本地开发 | `npm run dev`（3000 被占用时自动换 3001）                                                                                                                |
| 构建     | `npm run build`                                                                                                                                          |
| Lint     | `npm run lint`（ESLint）· `npm run lint:css`（stylelint，UI 令牌强约束）                                                                                 |
| 类型检查 | `npm run typecheck`（tsc strict）                                                                                                                        |
| 单元测试 | `npm run test`（Vitest，`*.test.ts` 与源码同目录）                                                                                                       |
| E2E      | `npm run test:e2e`（Playwright）                                                                                                                         |
| 数据维护 | `npm run maintain`（任意时刻可跑：自动补漏跑交易日，盘中用实时值，收盘后重跑得终值）· `npm run task -- run sync:kline-daily -- --status`（查数据完整性） |

**交付门槛**：`build` + `typecheck` + `lint` + `lint:css` 四项全绿；涉及业务逻辑的改动必须补/改测试；UI 改动另过 `docs/UI_SPEC.md` §7 检查清单。

## 代码结构（src/）

- `app/`：路由层。`page.tsx` 首页（七张入口卡片）、`dashboard/` 行情看板页（原首页终端，默认上证指数，支持 `?symbol=` 深链）、`market/` 行情中心页（指数概览 + 板块榜 + 自选）、`screener/` 选股中心页（领涨看板，market.db 只读快照）、`trade/` 模拟交易页、`simtrade/` 极速模拟页、`admin/` 管理页（`simtrade/` 模拟设置、`concepts/` 概念管理）、`api/` BFF 十二接口（kline / timeshare / quote / search / market / screener-board / admin-concepts / sim-state / sim-orders / sim-session / sim-replay / healthz）、`globals.css` **唯一样式文件**。
- `components/terminal/`：行情终端组件（`TradingTerminal` 及工具栏 / 信息表格 / 指标弹窗，图表生命周期统一在 `useChartTerminal`）。
- `components/trading/`：模拟交易组件（`PaperTrading` / `TradeSummary` / `OrderPanel` / `PositionsTable` / `TradesTable`，`useNotice` + `TradeToast` 为 Toast 通知 hook 与双轨呈现组件）。
- `components/home/`：首页入口组件（`HomeLanding`：行情中心 / 选股中心 / 看板 / 交易 / 极速模拟 / 模拟设置 / 概念管理七张入口卡片）。
- `components/admin/`：管理页组件（`ConceptAdmin` 概念管理：概念/大类增删改 + 组内排序 + 成分股划转，经 /api/admin/concepts）。
- `components/market/`：行情中心组件（`MarketCenter`：指数概览 + 板块榜单 + 自选收藏；`StarButton` 自选星标，与领涨看板共用）。
- `components/screener/`：选股中心组件（`ScreenCenter` 页壳 / `LeaderBoard` 领涨看板 / `ConceptTreemap` 概念热力 / `LeaderTable` 领涨股表）。
- `lib/screener/`：领涨看板视图类型域（环境无关，两端共用）——`types.ts` 看板元信息 + 概念热力 + 领涨股行视图模型（SSR 与 /api/screener/board 共用）。
- `lib/concepts.ts`：概念管理视图类型域（环境无关，两端共用）——全景/概念行/大类分组/成分与搜索行 + 写动作结构（/admin/concepts 与 /api/admin/concepts 共用）。
- `lib/watchlist.ts`：自选收藏 localStorage 存取（行情中心 / 领涨看板共用）。
- `lib/chart/`：环境无关的图表域逻辑（`ChartTerminal` 命令式控制器、`DataLoader`、分时状态机、纯函数及测试）。对 klinecharts 一律动态 `import()`，**禁止进入服务端模块图**。
- `lib/server/`：仅服务端（`market-service` 数据源编排、`provider/tencent` 腾讯实现、`trading/` 模拟交易服务域【contract/registry/engine + local（node:sqlite 持久化），/simtrade 账务与回放会话权威结算】、`market-db/` 行情快照库只读访问与领涨看板计算 + `concepts.ts` 概念管理域（**唯一写入口**：短生命周期可写连接事务 + sort normalize，写后失效看板缓存；node:sqlite，dbdata/market.db）、TTLCache、限流、zod、pino），禁止被客户端引用。
- `lib/trading/`：模拟交易域（环境无关，两端共用，均带测试）——`rules.ts` 买卖规则纯函数（标的准入、涨跌停、费用、下单校验、成交价）；`events.ts` 用户交易事件 + 事件引擎（init_order / select_side / place_order → 规则校验 → 成交，初始化默认委托最大可买，客户端 /trade 与服务端 /simtrade 共用管线）；`account.ts` 账务纯函数（整手买入、T+1、权益）+ localStorage 持久化；`replay.ts` 回放引擎纯函数；`messages.ts` 交易消息目录（code → `'中文|English'` 双语文案单一来源，`msg()` 支持 `{key}` 插值——rules/engine/组件共用，服务端拒单与客户端预检口径一致）；`protocol.ts` + `sim-api.ts` 为 /api/sim 传输协议与客户端请求封装。
- `proxy.ts` / `instrumentation*.ts`：边缘 404 与 `x-request-id` 注入、启动日志与优雅停机。

## 代码结构（scripts/，仓库根）

- `scripts/`：market.db 数据维护任务系统（**腾讯源**，与 BFF 同上游；K 线/事件写入只在此处；概念体系（concepts / stock_concepts / 领涨事件概念维度）另可经 /admin/concepts 管理页写入）——`task.mjs` 任务注册表与统一入口、`lib/`（db 连接 WAL + 状态文件 + http 重试 + 腾讯封装）、`sync/kline-daily.mjs` 日 K 同步（自动补漏跑交易日 + 当日实时/终值快照，任意时刻可跑，upsert 幂等，`--status` 查完整性）、`sync/leaders.mjs` 领涨事件本地自算（增量，`--from` 强制重算）、`maintain.mjs` 统一维护入口（`final_through` 完整性口径落 `scripts/task_runs.json`）。

## 必读文档（按任务选读）

| 场景                            | 文档                                                                 |
| ------------------------------- | -------------------------------------------------------------------- |
| 任何 UI 新增/修改（必读）       | `.trae/rules/project_rules.md` → `docs/UI_SPEC.md`（令牌/组件/清单） |
| 架构与机制（SSR/BFF/分时/缓存） | `docs/ARCHITECTURE.md`                                               |
| 目录职责明细                    | `docs/DIRECTORY.md`                                                  |

注：`ARCHITECTURE.md` 中描述的 `[symbol]` 动态路由已不在当前代码中，以 `app/` 实际路由为准。

## 硬性约束（违反即返工）

1. **红涨绿跌**（A 股语义，不可反转）：涨/盈利 = `var(--up)`（红），跌/亏损 = `var(--down)`（绿）；动作色：买入 = `var(--up)`（红）、卖出 = `var(--tb-active)`（品牌蓝，UI_SPEC v2.9 起），与 `lib/chart/constants.ts` 的 K 线配色联动。
2. **样式令牌制**：颜色/圆角/阴影/字族只引用 `globals.css` 顶部设计令牌；`lint:css` 会拦截组件区硬编码 hex、阶外圆角与非令牌字族；新增令牌先在 `docs/UI_SPEC.md` §2 登记。
3. **数值排版**：金额/价格/百分比/股票代码必须 `font-family: var(--font-num)` + `font-variant-numeric: tabular-nums`，数字列右对齐（`.num`）。
4. **图表不参与 SSR**：klinecharts 只能动态 `import()`；服务端渲染外壳（工具栏 + 信息表格）与数据。
5. **CSS 命名空间**：选择器一律 `#app` 前缀；禁止内联样式、新建 CSS 文件、CSS-in-JS。
6. **深浅双主题**：深色 = `#app.dark` 仅切变量值；两主题必须同时验收，正文对比度 ≥ 4.5:1。
7. **交互与文案**：过渡统一 `0.2s ease`（只过渡颜色/阴影/透明度类属性）；图标内联 SVG（禁 emoji）；文案一律 `t('中文|English')`。
8. **UI 优化 ≠ 功能变更**：样式/标记结构调整不得改动业务逻辑、数据流与交互行为。

## 提交

Conventional Commits（commitlint + husky 强制）；pre-commit 对暂存文件自动执行 ESLint / Prettier / stylelint。
