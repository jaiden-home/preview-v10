# KLineChart A 股行情预览（Preview · SSR）

基于 [Next.js](https://nextjs.org)（App Router）与 [KLineChart](https://github.com/klinecharts/KLineChart) v10 构建的 A 股 K 线预览应用，覆盖沪（sh）、深（sz）、北（bj）三市场，支持个股、指数与科创板标的。由原「纯客户端 SPA」改造为**全量服务端渲染（SSR）+ BFF 行情代理**的企业级工程化架构：首屏行情数据服务端直出、按标的动态路由生成 SEO 元数据、上游行情统一在服务端聚合与缓存。

## 架构总览

```
浏览器
  ├── SSR HTML（/ 与 /[symbol]：工具栏 + 信息表格首屏真实数据 + SEO meta）
  └── 客户端水合（klinecharts 画布初始化 + 交互）
        │  /api/kline  /api/timeshare  /api/quote  /api/search
        ▼
BFF 路由层（Route Handlers）
  ├── zod 参数校验 ── 滑动窗口限流（按 IP）
  ├── TTL 缓存（在途请求去重）
  └── 腾讯行情上游（服务端 fetch，GBK 解码，超时与错误兜底）
```

关键设计：

- **图表不参与 SSR**：klinecharts 是 Canvas 库（官方明确不支持服务端初始化），相关模块全部经动态导入隔离在客户端；服务端只渲染外壳与数据
- **首屏加速**：页面服务端并行拉取「实时快照 + 初始日 K」（带 3s 超时兜底），信息表格直出真实行情，图表 init 免首轮网络往返；上游失败时回退客户端补拉
- **BFF 解锁能力**：smartbox 联想接口在浏览器端无 CORS 头，经服务端代理后**支持按名称/拼音搜索标的**（原 SPA 仅支持 6 位代码）
- **SEO**：`/[symbol]` 动态路由（如 `/sh600519`），`generateMetadata` 注入股票名标题与描述；客户端切换标的用 `history.pushState` 同步 URL，不做服务端导航以保持瞬时切换

## 技术栈

| 依赖                                    | 用途                                         |
| --------------------------------------- | -------------------------------------------- |
| Next.js 16（App Router, standalone）    | SSR / 路由 / Route Handlers / 中间件         |
| React 19 + TypeScript（strict）         | UI 层（组件 + `ChartTerminal` 命令式控制器） |
| klinecharts v10                         | 图表引擎（客户端动态导入）                   |
| zod                                     | 边界参数校验（API 查询 / 环境变量）          |
| pino                                    | 结构化日志（requestId 关联）                 |
| Vitest + Testing Library                | 单元 / 组件测试                              |
| Playwright                              | E2E 冒烟（SSR 断言 + 水合）                  |
| ESLint + Prettier + husky + lint-staged | 代码规范与提交门禁                           |
| Docker（多阶段）+ GitHub Actions        | 交付与 CI/CD                                 |

## 快速开始

环境要求：Node.js ≥ 20.9

```bash
npm install
npm run dev
# 打开 http://localhost:3000
```

生产运行（standalone 产物，与 Docker 镜像一致）：

```bash
npm run build
node .next/standalone/server.js
```

Docker：

```bash
docker build -t klinecharts-preview .
docker run -p 3000:3000 klinecharts-preview
# 容器内置 HEALTHCHECK（/api/healthz）
```

## 可用脚本

| 命令                              | 说明                                              |
| --------------------------------- | ------------------------------------------------- |
| `npm run dev`                     | 开发服务器（Turbopack）                           |
| `npm run build` / `npm start`     | 生产构建 / 启动                                   |
| `npm run lint` / `npm run format` | ESLint / Prettier                                 |
| `npm run typecheck`               | TypeScript 严格检查                               |
| `npm test` / `npm run test:watch` | 单元 + 组件测试（Vitest）                         |
| `npm run test:e2e`                | Playwright 冒烟（自动构建并启动 standalone 服务） |

## 项目结构

```
├── src/                        # 源码根（Next.js src 布局）
│   ├── app/
│   │   ├── layout.tsx          # 根布局（meta / #app 命名空间）
│   │   ├── page.tsx            # 首页（默认上证指数）
│   │   ├── [symbol]/page.tsx   # 动态标的路由 + generateMetadata
│   │   ├── loading/error/not-found.tsx
│   │   └── api/                # BFF：kline / timeshare / quote / search / healthz
│   ├── components/terminal/    # TradingTerminal 及工具栏 / 信息表格 / 弹窗组件
│   ├── lib/
│   │   ├── chart/              # 与环境无关的图表域逻辑
│   │   │   ├── terminal.ts     # ChartTerminal：klinecharts 命令式控制器（仅客户端实例化）
│   │   │   ├── data-loader.ts  # DataLoader（BFF 版：init/forward/backward + 3s 轮询）
│   │   │   ├── registers.ts    # 自定义指标/坐标轴注册（TIME、VOL、MA 覆盖、换手率、振幅、百分比轴）
│   │   │   ├── timeshare.ts    # 分时状态机纯函数（解析/均价/对称区间）
│   │   │   ├── utils.ts        # 时间解析 / K 线解析 / 聚合 / 市场推断
│   │   │   ├── info-cells.ts   # 信息表格单元格构建（SSR 直出同源）
│   │   │   └── params.ts       # 指标参数弹窗辅助（标签/钳制/取整）
│   │   ├── fundamental.ts      # 腾讯实时行情文本解析 + 基本面回溯
│   │   ├── i18n.ts             # 双语文案（#en-US hash，与原 SPA 兼容）
│   │   └── server/             # 仅服务端：tencent 客户端 / TTL 缓存 / 限流 / pino / zod / env
│   ├── proxy.ts                # /api/* 注入 x-request-id
│   └── instrumentation*.ts     # 启动日志 + 优雅停机（Node 分支）
├── e2e/                        # Playwright 冒烟
├── tests/                      # ChartTerminal 集成测试（mock klinecharts）
├── Dockerfile / .github/workflows/ci.yml
└── vitest.config.ts / playwright.config.ts / eslint.config.mjs
```

## BFF 接口

| 路径                 | 参数                       | 返回                               |
| -------------------- | -------------------------- | ---------------------------------- |
| `GET /api/kline`     | `symbol, period, from, to` | `{ bars: KLineData[] }`            |
| `GET /api/timeshare` | `symbol`                   | `{ date, prevClose, bars }`        |
| `GET /api/quote`     | `symbol`                   | 名称/现价/昨收 + 基本面            |
| `GET /api/search`    | `q`                        | `{ items }`（代码精确 + 名称联想） |
| `GET /api/healthz`   | -                          | `{ status, uptime, timestamp }`    |

统一行为：zod 校验失败 → 400；超限 → 429；上游失败 → 502；响应 `Cache-Control: no-store`（新鲜度由服务端 TTL 缓存管理）。缓存 TTL 可用环境变量调整（`CACHE_QUOTE_TTL_MS` 等，见 `lib/server/env.ts`）。

## 功能特性

### 行情与数据

- **三市场覆盖**：沪市、深市、北交所，输入 6 位代码自动按前缀推断市场（`60/68/900` → sh，`43/83/87/88/92` → bj，`00/20/30` → sz），**支持名称/拼音搜索**（服务端 smartbox）
- **常用标的一键切换**：上证指数、深证成指、创业板指、沪深 300、科创 50、中证 500
- **周期齐全**：分时、1/5/15/30 分钟、1/4 小时、日、周、月；腾讯不直接提供的周期（如 4 小时）由 60 分钟线服务端聚合
- **历史加载**：向左滚动按需加载更早数据，每次 500 根；日/周/月线为前复权
- **实时更新**：3 秒轮询（BFF 侧同 TTL 缓存，多客户端同频只打一次上游）；分时模式下跨交易日自动整体重载
- **时区**：图表固定 `Asia/Shanghai` 时区

### 分时图

- 面积走势线（白线）+ 均价线（黄线）+ 昨收基准虚线
- **双 Y 轴**：右侧价格轴，左侧百分比涨跌幅轴
- **昨收居中**：Y 轴区间以昨收为中心对称化
- **全天一屏**：按 242 根分钟线自动定 bar 宽，未交易时段右侧留白
- **X 轴交易时段锚点**：`09:30 / 10:30 / 11:30/13:00 / 14:00 / 15:00`，窄屏自动精简
- **均价线口径按标的区分**：个股官方额量比（科创板 200 股/手自动换算、北交所缺额近似）；指数用按量加权点位均值

### 指标与信息表格

- **主图指标**：MA、EMA、SMA、BOLL、SAR、BBI；**副图指标**：VOL、MACD、KDJ、RSI、BIAS、CCI、WR、DMI、OBV、PSY、DMA、EMV、ROC、TRIX、VR、MTM、换手率、振幅
- **覆盖内置 MA/VOL**：tooltip 图例并入首行；量柱红绿按昨收判定与 K 线同步（A 股习惯）
- **指标参数设置弹窗**：中英文标签、最小值钳制、整数/小数参数区分；工具栏入口保持隐藏（与原版一致）
- **信息表格**：K 线行情 + 基本面（换手率、市值、市盈 TTM/动/静、市净率）混排；十字光标悬停联动回溯（振幅/换手精确重算，估值按价格比例近似）；SSR 直出首帧

### 交互与外观

- **A 股配色**：红涨绿跌按昨收判定，全局统一
- **右键切换鼠标选择**、明暗主题、绘图工具（11 种）、`#en-US` 中英切换、移动端适配、`#app` 样式隔离

## 测试

- **纯函数**（Vitest）：时间解析、K 线解析与坏行过滤、聚合、市场/指数识别、分时点解析（量额差分、科创板、北交所）、均价四种口径、对称区间、参数钳制、信息表格构建、smartbox/qt 解析、TTL 缓存、限流窗口
- **数据加载器**：init/forward/backward 语义、SSR 首屏注入、失败兜底、在途切走保护、轮询去重与跨日重载
- **ChartTerminal 集成**（mock klinecharts）：初始化顺序、A 股配色、分时状态机（激活仅切周期 → 数据就绪同帧形态 → 全天一屏校准 → 退出恢复）、右键十字光标、主题重应用、destroy 释放
- **组件**（Testing Library）：指标参数弹窗全交互路径
- **E2E**（Playwright）：SSR HTML 断言、水合出 canvas、动态路由标题、404、健康检查、BFF 参数校验

## 部署

- **Docker**：多阶段构建（deps → build → runner），standalone 产物 + 非 root 用户 + `HEALTHCHECK`（`/api/healthz`）
- **CI/CD**（GitHub Actions）：`quality`（format/lint/typecheck/unit）→ `e2e`（构建 + Playwright）→ `docker`（main 分支构建镜像，GHA 缓存）
- **可观测性**：pino 结构化日志、`x-request-id` 中间件关联、启动/停机日志；多实例部署时将进程内缓存与限流替换为 Redis 即可（接口已收敛在 `lib/server`）

### 环境变量

| 变量                    | 默认                              | 说明                 |
| ----------------------- | --------------------------------- | -------------------- |
| `PORT` / `HOSTNAME`     | `3000` / `0.0.0.0`                | 服务监听             |
| `LOG_LEVEL`             | `info`                            | pino 级别            |
| `UPSTREAM_TIMEOUT_MS`   | `5000`                            | 上游请求超时         |
| `CACHE_QUOTE_TTL_MS` 等 | 见 `lib/server/env.ts`            | 各接口缓存 TTL       |
| `RATE_LIMIT_PER_MINUTE` | `240`                             | 每 IP 每分钟请求上限 |
| `SITE_URL`              | `https://preview.klinecharts.com` | metadata base        |

## 已知限制

- 指标参数设置弹窗入口保持隐藏（与原版一致）
- 副图「换手率」指标为相对近似（无流通股本数据）；信息表格中的为接口真实值
- 行情依赖腾讯公开接口，变更或限流时数据可能中断；SSR 上游超时回退客户端补拉，失败显示 `--` 占位
- 语言切换沿用 `#en-US` hash（图表注册文案随加载时语言固化，切换需刷新）

## License

[Apache-2.0](./LICENSE)

## Links

- [KLineChart](https://github.com/klinecharts/KLineChart)
- [Pro](https://github.com/klinecharts/pro)
