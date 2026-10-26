# /screener 选股中心改造 · 开发计划与进度跟踪

> 本文档为本次改造的任务清单与进度账本，落盘防中断。每完成一项将更新状态。
> 创建：2026-10-26 · 状态标记：☐ 待办 / ◐ 进行中 / ☑ 完成

## 一、需求背景

- 参照 `market` 项目首页（本地 SQLite 直读的 A 股看板：概念板块热力 treemap + 历史领涨股表 + 趋势/B 点技术指标 + 多维筛选）。
- 结合 `stock-sim` 现有 `/screener`（条件组合器：指标×参数×运算符×阈值 AND 组合 + 日期区间历史模式 + 分片渐进运行）。
- 数据库直接复制 `market/dbdata/db/market.db`（2.4GB，6 表，数据截至 2026-10-23），不重新跑数。
- UI 重新设计（ui-ux-pro-max + web-design-guidelines 技能辅助），遵循 stock-sim 设计令牌制 / 双主题 / i18n / 红涨绿跌硬约束。

## 二、需求点（调研结论）

| #   | 需求点                                                                                                                                              | 来源               | 方案                                                                                              |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ | ------------------------------------------------------------------------------------------------- |
| R1  | 概念板块热力图（日/周/月/年四周期，面积=涨股比广度、颜色=平均涨幅，点击放大、多选子概念联动筛表）                                                   | market 首页        | 移植 treemap-heatmap 库（复制 public/treemap-heatmap.min.js），数据由 board 服务计算              |
| R2  | 历史领涨股表：代码/名称/概念/涨幅/价格/半年最高/一年最高/一年涨停/领涨天数/一年领涨/连涨/连高/最近B点/B点连涨/均线比/趋势天数/本月进入，17 列可排序 | market 首页        | board 服务全量计算返回，客户端排序/筛选                                                           |
| R3  | 趋势过滤 + B 点口径（≥60 根日K、上市满一年、3 周强涨链、均线规则；B=连涨链第 3 日+MA30+动能双下限）                                                 | market 首页        | 与 market 页面口径一致移植，常量集中定义                                                          |
| R4  | 数据总览卡（历史领涨股/趋势达标/领涨日/启用股票/覆盖概念/停用数）                                                                                   | market 首页        | board meta                                                                                        |
| R5  | 搜索 + 大板块 + 12 项字段下拉筛选 + 一键清除 + 本月新进红点 + 新高价高亮 + 口径说明                                                                 | market 首页        | 客户端过滤                                                                                        |
| R6  | 条件组合器（8 技术指标 + 4 基本面，1~8 条 AND，gt/lt/between，日期区间历史模式，策略 localStorage 持久化）                                          | stock-sim screener | 完整保留，UI 重构                                                                                 |
| R7  | 筛选数据源提速：全池从「腾讯 API 探测 ~2000 只」升级为「本地 DB 启用股 ~5200 只」，日K 直接读 kline_daily                                           | 本次改造           | service/universe 重写数据源，保留分片契约与轮询交互；基本面经腾讯快照回填（仅含基本面条件时预筛） |
| R8  | 结果深链 /dashboard?symbol= + 星标自选（与行情中心共用）                                                                                            | stock-sim screener | 保留                                                                                              |
| R9  | 双主题、中英双语、红涨绿跌、等宽数字、≤768px 响应式                                                                                                 | 两项目规范         | 遵守 stock-sim UI_SPEC                                                                            |

## 三、架构方案

```
页面  src/app/screener/page.tsx（服务端：SSR 初载 board → <ScreenCenter initialBoard>）
组件  src/components/screener/
        ScreenCenter.tsx    Tab 壳（领涨看板 | 条件选股）+ 刷新
        LeaderBoard.tsx     概览卡 + 概念热力图 + 已选概念 chips
        LeaderTable.tsx     领涨股表（排序/筛选/搜索/标记/口径说明/移动端票据）
        ConceptTreemap.tsx  treemap 封装（Script 按需加载，选中联动）
        Screener.tsx        条件组合器（重构保留全部行为）
数据  src/lib/server/market-db/
        db.ts               node:sqlite 只读单例（WAL）
        board.ts            loadBoard()（移植 market 首页 loadDashboard 口径）
API   GET /api/screener/board     board JSON（force-dynamic + 限流 + 60s TTLCache）
      POST /api/screener          契约不变，数据源切本地 DB
资源  public/treemap-heatmap.min.js（自 market 复制）
      dbdata/market.db（自 market sqlite .backup 复制）
```

## 四、任务分解与进度

### Phase 0 准备

- ☑ T0.1 复制 market.db → stock-sim/dbdata/market.db（`sqlite3 .backup`，保证 WAL 一致性；确认磁盘空间）
- ☑ T0.2 复制 treemap-heatmap.min.js → stock-sim/public/
- ☑ T0.3 本计划文档落盘

### Phase 1 服务端数据层（board）

- ☑ T1.1 `lib/server/env.ts` 增加 `MARKET_DB_PATH`（默认 ./dbdata/market.db）
- ☑ T1.2 `lib/server/market-db/db.ts`：只读单例 + 表存在性/状态
- ☑ T1.3 `lib/server/market-db/board.ts`：类型 + `loadBoard()`（概览/四周期概念热力/领涨聚合/趋势过滤/B 点/本月进入标记，口径常量集中）
- ☑ T1.4 `app/api/screener/board/route.ts`：GET，限流，TTLCache 60s，库缺失时 503 语义化 JSON
- ☑ T1.5 board 单元测试（:memory: 夹具库，覆盖热力聚合/趋势过滤/B 点/本月进入）

### Phase 2 条件选股服务切 DB

- ☑ T2.1 `universe.ts` 重写：池 = stocks.enabled=1（代码/名称/板别），快照回填（名称外的现价/基本面）沿用腾讯批量报价 + 24h 缓存，按需触发
- ☑ T2.2 `service.ts` 重写：日K 读 kline_daily（分片 SQL，700 自然日窗口），保留 ScreenerRunView 分片/TTLCache/游标契约；纯基本面策略先回填快照再终判
- ☑ T2.3 回归 `lib/screener` 域测试 + service 冒烟（dev 环境）

### Phase 3 UI 设计与实现

- ☑ T3.1 加载 ui-ux-pro-max + web-design-guidelines，产出设计方案（布局/层级/交互/状态）
- ☑ T3.2 ScreenCenter：Tab 壳（领涨看板 / 条件选股）+ 数据截至徽标 + 手动刷新
- ☑ T3.3 LeaderBoard：6 张概览卡 + ConceptTreemap + 已选概念 chips（联动筛表）
- ☑ T3.4 LeaderTable：17 列三态排序 + 搜索 + 12 下拉筛选 + 清除 + 新进红点/新高红价 + 口径说明 + 移动端票据
- ☑ T3.5 ConceptTreemap：四周期切换/放大/Esc 返回/多选保留/tooltip（Wilson CI）
- ☑ T3.6 Screener 条件组合器重构：接入新壳，行为不变（策略持久化/区间模式/渐进进度/星标/深链）
- ☑ T3.7 globals.css：新增选股中心样式（全部走令牌，#app 前缀，双主题，≤768px 响应式，t() 双语）

### Phase 4 质量门槛与收尾

- ☑ T4.1 `npm run test` / `typecheck` / `lint` / `lint:css` / `build` 全绿
- ☑ T4.2 dev 起服验证：SSR 首屏 / board API / 条件选股运行 / 双主题切换 / 移动端断点
- ☑ T4.3 更新 `docs/UI_SPEC.md`（§3 组件登记；如新增令牌先 §2 登记）、`docs/DIRECTORY.md`、页面 metadata
- ☑ T4.4 终检 UI_SPEC §7 清单 + 本文档进度收尾

## 五、口径备忘（与 market 首页一致）

- 趋势过滤：≥60 根日K + 上市满一年（首根K线 ≤ 最新交易日−365 自然日）+ 当日在市 + 周线 3 周强涨链（当周收盘 ≥ 上周最低）+ 均线规则（收盘站上 MA30/MA60 较低者）
- B 点：连涨链恰第 3 日（high 容差 0.999、收盘过前收）+ close ≥ MA30 + R2+R3 ≥ R1×0.5 + R3 ≥ R2×0.15；窗口近 1 年 + 60 自然日预热
- 涨停：主板 10% / 创业板 20%，与昨收比，容差 0.05
- 热力周期：日=昨收基准；周/月/年=近 7/30/365 自然日，基准=窗口起点前最后交易日收盘；颜色满幅 日±10/周±20/月±30/年±60
- 领涨天数 = leader_events 内该股发生领涨的交易日数（同日多概念不重复计）

## 六、进度日志

- 2026-10-26：调研两项目完成，计划落盘，开始 Phase 0。

## 七、完成核验（2026-10-26）

- **Phase 0**：market.db 经 `sqlite3 .backup` 复制（2.4G，quick_check ok，数据截至 2026-10-23）；treemap-heatmap.min.js 复制完成；发现并修复 `proxy.ts` 根路径白名单拦截静态脚本问题。
- **Phase 1**：`lib/server/market-db/`（db 只读单例 + board 口径移植）+ `/api/screener/board`；单测 6/6 通过；真库冒烟：292 只趋势达标领涨股 / 31 大类 / 144 概念 / 290 只有 B 点，冷载 ~7s（缓存后 3s）。
- **Phase 2**：条件选股切本地库——纯技术策略全池 4416 只 ~2.3s 完成（实测 RSI<30 命中 1035，实时价全量刷新）；历史模式（asOf 区间扫描、命中日/截止日收盘口径）实测通过；含基本面策略按需回填腾讯快照（24h 缓存）。
- **Phase 3**：ScreenCenter 双模式壳 + LeaderBoard + ConceptTreemap + LeaderTable + Screener 重构 + globals.css `.screen-*` 令牌化样式段；全量 `t()` 双语。
- **Phase 4**：test 329/329、typecheck、lint（0 error，38 条存量 warning）、lint:css、build 全绿；浏览器实测：SSR 首屏/总览卡/热力图 144 色块渲染与四周期切换/热力缩放管线/领涨表 292 行与 12 项筛选/条件选股端到端渐进运行/422 双语错误横幅/深浅主题切换均通过、控制台零错误。
- **文档**：UI_SPEC §3.16 重写 + v2.65 变更记录；DIRECTORY.md / AGENTS.md 同步；本计划收尾。

### 遗留说明

- 热力图「放大态点选子概念」交互链路与 market 生产页逐行同构（缩放管线已实测验证）；嵌入式测试浏览器的点击命中存在坐标怪癖，未能自动化点选验证，建议真实浏览器人工确认一次。
- 条件选股日 K 为 market.db 不复权快照（与领涨看板同口径）；腾讯实时价仅用于当前模式结果展示与基本面快照回填。
