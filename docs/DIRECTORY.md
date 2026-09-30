# 目录结构说明

本文档介绍项目每个文件夹的职责与内容。整体架构可参考 [ARCHITECTURE.md](./ARCHITECTURE.md)。

```
stock-sim/
├── .github/
├── .husky/
├── docs/
├── e2e/
├── public/
├── src/
│   ├── app/
│   ├── components/
│   └── lib/
└── tests/
```

## src/

源码根目录（Next.js `src` 布局），应用代码与仅服务端入口全部收敛于此；`public/`、测试与配置文件按惯例留在仓库根。路径别名 `@/*` 指向 `src/*`。除 `app/`、`components/`、`lib/` 三个子目录外，还包含：

- `proxy.ts`：边界代理（即 Next.js middleware），非法标的路由在边缘直接 404，并为 `/api/*` 注入 `x-request-id` 供日志关联。
- `instrumentation.ts`：服务端插桩入口，按运行时分发（Edge bundle 中 node 分支被摇树移除）。
- `instrumentation-node.ts`：仅 Node 运行时加载，输出启动日志并记录 SIGTERM/SIGINT 优雅停机信号。

### src/app/

Next.js App Router 的应用根目录，包含全部页面路由与 BFF 接口。

- `[symbol]/`：动态标的路由（如 `/sh600519`），`page.tsx` 内通过 `generateMetadata` 注入股票名标题与描述，服务端并行拉取实时快照与初始日 K 直出首屏。
- `api/`：BFF 路由层（Route Handlers），所有上游行情的唯一出口。
  - `kline/`：K 线数据（`symbol, period, from, to` → `{ bars }`，按需向左加载历史）。
  - `timeshare/`：分时数据（当日分钟线 + 昨收基准）。
  - `quote/`：实时快照（名称/现价/昨收 + 基本面估值）。
  - `search/`：标的搜索（6 位代码精确匹配 + smartbox 名称/拼音联想）。
  - `healthz/`：健康检查（`{ status, uptime, timestamp }`，供 Docker HEALTHCHECK 与探活使用）。
- `dashboard/`：行情看板页（原首页终端整体迁移，默认上证指数，服务端直出首屏行情与日 K）。
- `trade/`：模拟交易页（客户端虚拟账户 + BFF 行情轮询）。
- `simtrade/`：极速模拟页（历史回放 + 虚拟时钟，账务由 `/api/sim/*` BFF 权威结算）。
- `admin/`：管理命名空间；`admin/simtrade/` 模拟设置页（标的 / 起止日期 / 倍速 / 开始暂停开关）。
- 根级文件：`layout.tsx`（根布局与 `#app` 命名空间）、`page.tsx`（首页入口页，仅承载行情看板与模拟交易两个入口）、`loading.tsx` / `error.tsx` / `not-found.tsx`（路由级加载、错误与 404 兜底）、`globals.css`（全局样式）。

### src/components/

React UI 组件，按页面域分子目录（`terminal/` 行情终端、`trading/` 模拟交易、`home/` 首页入口）：

- `home/HomeLanding.tsx`：首页入口页（行情看板 / 模拟交易两张入口卡片，独立主题切换）。

- `TradingTerminal.tsx`：终端主组件，负责组装工具栏、信息表格与图表挂载点。
- `SymbolPicker.tsx` / `PeriodGroup.tsx`：标的搜索切换与周期（分时/分钟/日/周/月）切换；`PeriodGroup` 支持 `simple` 精简模式（仅日/周/月，交易页图表用）。
- `ChartTools.tsx`：图表工具组（主/副图指标 + 绘图 + 清除绘图），行情页与交易页工具栏共用段，元素 id 可加前缀。
- `IndicatorMenu.tsx` / `IndicatorModal.tsx`：指标选择菜单与指标参数设置弹窗（含 `IndicatorModal.test.tsx` 组件测试）。
- `DrawingMenu.tsx`：绘图工具菜单（11 种画线工具）。
- `InfoTable.tsx`：行情 + 基本面混排信息表格（SSR 直出同源）。
- `ThemeToggle.tsx`：明暗主题切换。
- `useDismiss.ts`：弹窗外点击关闭的通用 Hook。
- `useLocale.ts`：语言钩子（SSR 首帧 zh-CN，挂载后按 `#en-US` hash 校正）。
- `useChartTerminal.ts`：图表终端交互钩子（行情页与交易页共用）：ChartTerminal 生命周期（创建/销毁/换标的/主题）与周期、指标、绘图控件状态。

组件层不直接触碰 klinecharts 实例，图表命令经 `lib/chart/terminal.ts` 的 `ChartTerminal` 控制器下发。

### src/lib/

与框架解耦的核心业务逻辑，按运行环境划分为三部分：

- `chart/`：与环境无关的图表域逻辑（可在 Node 与浏览器复用，纯函数为主）。
  - `terminal.ts`：`ChartTerminal`，klinecharts 命令式控制器，仅客户端实例化。
  - `data-loader.ts`：`DataLoader` 数据加载器（init/forward/backward + 3 秒轮询 + 跨日重载）。
  - `registers.ts`：自定义指标 / 坐标轴注册（TIME、VOL、MA 覆盖、换手率、振幅、百分比轴）。
  - `timeshare.ts`：分时状态机纯函数（点位解析、均价口径、昨收对称区间）。
  - `utils.ts`：时间解析、K 线解析与坏行过滤、周期聚合、市场推断。
  - `info-cells.ts`：信息表格单元格构建（SSR 与客户端共用同一份）。
  - `params.ts`：指标参数弹窗辅助（中英文标签、取值钳制、整型/浮点区分）。
  - `api.ts` / `types.ts` / `constants.ts`：BFF 请求封装、领域类型与常量。
  - `*.test.ts`：上述模块的单元测试（与源码同目录）。
- `server/`：仅服务端使用的模块（不进入客户端 bundle）。
  - `market-service.ts`：行情服务（BFF 路由与页面的唯一入口）：数据源编排、能力降级、SSR 初始数据聚合。
  - `provider/`：数据源抽象层（切换服务商只动此目录）。
    - `types.ts`：`MarketDataProvider` 接口 + `ProviderCapabilities` 能力声明 + `ProviderError`。
    - `registry.ts`：按 `DATA_PROVIDER` 环境变量选择数据源实例（进程内单例）。
    - `periods.ts`：周期兜底计划（原生周期透传，缺口周期基周期拉取 + 本地聚合）。
    - `contract.ts`：provider 契约测试套件（新数据源上线须通过）。
    - `tencent/`：腾讯数据源实现（`http` 传输 / `parse` 协议解析 / `quote`·`kline`·`timeshare`·`search` 四类接口 / `index` 组装与缓存策略）。
  - `cache.ts`：TTL 缓存（含在途请求去重）。
  - `rate-limit.ts`：按 IP 滑动窗口限流。
  - `schemas.ts` / `env.ts`：zod 接口参数校验与环境变量解析。
  - `api.ts` / `logger.ts`：路由层公共封装与 pino 结构化日志。
- 根级文件：`fundamental.ts`（基本面展示回溯与信息表格渲染）、`i18n.ts`（中英双语文案，`#en-US` hash 兼容原 SPA）。

## tests/

跨模块集成测试（Vitest + Testing Library + jsdom）：

- `setup.ts`：测试环境全局设置（mock、匹配器等）。
- `terminal.test.ts`：`ChartTerminal` 集成测试（mock klinecharts，覆盖初始化顺序、A 股配色、分时状态机、主题重应用、destroy 释放等）。

## e2e/

Playwright 端到端冒烟测试：

- `home.spec.ts`：SSR HTML 断言、水合出 canvas、动态路由标题、404、健康检查、BFF 参数校验。

## public/

静态资源目录，直接按根路径对外服务，当前仅含 `logo.svg`。

## docs/

项目文档：

- `ARCHITECTURE.md`：架构设计说明。
- `DIRECTORY.md`：本文档（目录结构说明）。

## .github/

GitHub 配置：

- `workflows/ci.yml`：CI 流水线，依次执行 `quality`（format/lint/typecheck/unit）→ `e2e`（构建 + Playwright）→ `docker`（main 分支构建镜像）。

## .husky/

Git Hooks（由 husky 管理，配合 lint-staged 与 commitlint）：

- `pre-commit`：提交前对暂存文件执行 ESLint + Prettier。
- `commit-msg`：提交信息符合 Conventional Commits 规范。
