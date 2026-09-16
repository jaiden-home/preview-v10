import {
  init,
  registerIndicator,
  registerYAxis,
  type AxisCreateRangeCallback,
  type AxisCreateTicksCallback,
  type AxisRange,
  type AxisTick,
  type DataLoader,
  type IndicatorFigure,
  type KLineData,
  type CandleTooltipLegendsCustomCallback,
  type Period,
  type SymbolInfo,
  type TooltipLegend
} from 'klinecharts'

const LOGO_SVG = `<svg
    class="logo"
    viewBox="0 0 1024 1024"
    xmlns="http://www.w3.org/2000/svg">
    <path d="M502.415025 61.691107C471.599553 66.145413 454.38748 69.75649 432.000151 76.738336 403.231621 85.524669 383.129313 93.83034 351.592999 109.598497 266.491296 152.088199 190.418359 219.134514 141.667783 294.486523 102.428653 355.151766 80.399578 416.540083 71.372957 490.688399 68.605108 512.595238 68.242498 576.028266 70.649862 599.020724 77.030956 659.565812 92.316305 706.870284 117.9565 745.388443 129.027897 761.999829 152.140466 785.47076 167.908666 796.063683 188.371438 809.907219 211.60206 820.980761 231.944678 826.63876 239.769752 828.805835 241.694372 829.767073 241.213753 831.211075 237.845131 842.046453 234.111753 888.267386 235.195291 906.565228 236.879602 934.728629 238.686214 941.109701 247.832989 950.256477 254.093907 956.517394 262.279445 959.645707 277.084219 961.209864 311.750992 965.063396 356.768233 960.488936 390.231313 949.775858 431.637391 936.294931 463.416246 915.832159 494.95256 882.128769 498.803947 878.034927 502.174715 874.666305 502.29487 874.666305 502.535179 874.666305 508.073109 880.081848 514.57219 886.823384 554.416257 927.506474 603.405039 951.822779 661.302434 959.645707 682.368125 962.535857 724.978024 962.535857 737.37537 959.765862 752.903218 956.397239 762.172294 948.452011 766.023681 935.692012 770.958605 919.080627 771.319069 875.026769 766.746754 848.905998 765.300607 840.962915 764.339369 834.461688 764.459524 834.341533 764.699834 834.221379 769.154139 833.139986 774.449528 831.934148 821.153226 821.703835 864.966775 793.055524 895.541851 752.610598 913.114474 729.259822 928.402013 698.204127 938.874781 664.260428 943.809706 648.372116 950.310933 615.389654 952.716172 593.60518 955.363866 570.973272 955.726476 517.289789 953.439246 495.503169 944.650788 412.808851 913.595093 347.689302 855.096925 289.068834 827.051534 261.023442 796.478603 238.874213 745.921458 210.228048 725.338445 198.671763 711.256745 187.958664 703.431671 178.086669 700.423513 174.237428 694.28275 164.848154 689.950701 157.265578 675.14597 131.74556 664.913597 118.024345 650.228892 104.182954 633.978056 88.895437 617.006121 78.542802 595.942575 71.320647 573.553036 63.617873 563.442878 62.051571 533.110256 61.570952 518.183182 61.330664 504.461881 61.450798 502.415025 61.691107ZM758.559071 301.828832C761.329065 303.272834 764.940143 305.560064 766.384145 307.004066 771.07876 311.215917 775.052447 320.244684 775.052447 326.743765 775.052447 334.208375 757.717988 430.141165 755.312749 435.799249 750.255524 447.836088 739.902953 454.817848 727.385366 454.817848 715.228287 454.817848 706.562044 448.799471 702.107824 436.880555 700.060903 431.707467 700.060903 430.864238 702.708597 413.772234 704.274985 404.14278 705.718901 395.474456 705.959211 394.513154 706.922594 391.262455 691.034282 406.550122 566.813646 527.880566 535.99826 557.972878 505.663492 587.584572 499.406866 593.723189 481.711943 610.815193 475.69348 611.295812 459.202249 597.456567 433.562097 575.787871 384.212851 534.381793 382.526394 533.057946 380.842083 531.85421 378.434698 533.658719 365.073926 546.296418 347.981921 562.427184 296.585754 611.898688 270.102373 637.538883 227.009753 679.425601 213.286371 692.065553 208.473747 694.592985 199.927788 698.927243 187.287901 695.796742 181.149283 687.731358 176.937411 682.315901 175.250976 673.649658 176.937411 667.268586 178.26128 661.973111 180.428355 659.686053 218.946515 622.491654 227.852981 613.945652 242.77791 599.501342 252.046986 590.594876 326.435611 518.250983 367.601465 479.494703 372.175926 477.327627 382.646549 472.633076 389.991004 475.040354 404.918078 487.79825 410.211321 492.37271 427.545781 507.177484 443.434049 520.658325 459.32234 534.141484 473.52634 546.298563 475.090497 547.622367L477.740315 550.149993 493.145949 535.102721C592.091188 438.206548 619.293351 411.725313 641.079971 390.781922 655.163817 377.29885 666.477625 366.107299 666.237358 365.864844 665.997049 365.624534 657.090583 367.308846 646.377505 369.716231 624.108121 374.531001 616.768043 374.891465 610.386885 371.642997 594.498573 363.457459 590.765195 344.078224 602.684111 331.558535 610.146576 323.735607 605.331806 324.939299 697.413166 307.60484 715.348441 304.236217 732.079981 301.105759 734.727676 300.502839 743.996752 298.700519 753.143527 299.178992 758.561216 301.828832ZM680.92408 538.956254C687.42535 542.204721 692.840894 549.306807 693.804277 556.288567 694.76766 562.06672 692.720803 587.584572 690.193242 602.028882 684.777656 632.964487 670.934055 664.861201 651.43473 691.222238 636.629956 711.08428 615.203886 732.147869 597.028258 744.905679 589.685949 749.962904 586.915954 751.166596 581.981029 751.527061 574.27832 752.127834 567.897184 748.639057 562.72195 741.296747 559.593636 736.962596 558.990653 734.915675 558.990653 729.259822 558.990653 719.750501 561.638498 715.778895 575.842498 704.342744 610.026507 676.900272 630.971893 647.288578 640.961919 612.862114 645.175894 597.937186 646.379651 590.232266 647.340888 570.372499 648.184117 552.677554 648.306417 551.834261 651.795237 546.899337 658.897194 536.909333 670.211046 533.778874 680.92408 538.956254Z" fill="#e53935"/>
  </svg>`

const BAR_LIMIT = 500

const TIMESPAN_MILLIS: Record<Period['type'], number> = {
  second: 1000,
  minute: 60 * 1000,
  hour: 60 * 60 * 1000,
  day: 24 * 60 * 60 * 1000,
  week: 7 * 24 * 60 * 60 * 1000,
  month: 30 * 24 * 60 * 60 * 1000,
  year: 365 * 24 * 60 * 60 * 1000
}

// ==================== 分时图 ====================

export interface TimeShareDatum { avg: number }

interface TimeShareState {
  active: boolean
  prevClose: number
  dayKey: string | null
  /** 每手股数：主板/创业板/北交所 100，科创板 200 */
  lotSize: number
  /** 当前标的为市场指数：均价线改用按量加权的指数点位均值 */
  isIndex: boolean
}

export const timeShareState: TimeShareState = {
  active: false,
  prevClose: Number.NaN,
  dayKey: null,
  lotSize: 100,
  isIndex: false
}

// 科创板（688/689）每手 200 股，且腾讯分时接口的量为「股」；其余板块每手 100 股，量为「手」
export const isCnStarMarket = (symbol: { market?: unknown; ticker: string }): boolean =>
  symbol.market === 'sh' && /^(688|689)/.test(symbol.ticker)

// 市场指数：沪 000、深 399、北 899 开头（按市场前缀区分同名个股，如 sh000001 上证指数 / sz000001 平安银行）
export const isCnIndex = (symbol: { market?: unknown; ticker: string }): boolean =>
  (symbol.market === 'sh' && /^000/.test(symbol.ticker)) ||
  (symbol.market === 'sz' && /^399/.test(symbol.ticker)) ||
  (symbol.market === 'bj' && /^899/.test(symbol.ticker))

export const localDayKey = (timestamp: number): string => {
  const date = new Date(timestamp)
  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`
}

// 从最近若干日 K 中取展示日的前收盘价
export const pickPrevClose = (days: KLineData[], displayedDayKey: string, fallback: number): number => {
  if (days.length === 0) {
    return fallback
  }
  const index = days.findIndex(d => localDayKey(d.timestamp) === displayedDayKey)
  if (index > 0) {
    return days[index - 1].close
  }
  // 盘中日线尚未生成时，最近一根日线即展示日的昨日
  if (index === -1) {
    return days[days.length - 1].close
  }
  return days[0].open
}

const isTradingMinute = (hhmm: string): boolean =>
  (hhmm >= '0930' && hhmm <= '1130') || (hhmm >= '1300' && hhmm <= '1500')

// 官方分时点 "0930 1277.27 133 16987691.06" = 时间 价格 累计量 累计额(元)
// 主板/创业板/北交 quantity 单位为手，科创板为股（北交所无累计额列）
// 差分出每分钟量（统一转手）/额；open 取前一分钟价格（首根用 basePrice），供成交量按分钟涨跌着色
export const parseTimeShareDay = (date: string, points: unknown[], basePrice: number, sharesPerLot = 1): KLineData[] => {
  if (!/^\d{8}$/.test(date)) {
    return []
  }
  const bars: KLineData[] = []
  let prevCumVolume = 0
  let prevCumAmount = 0
  let prevPrice = basePrice
  for (const point of points) {
    if (typeof point !== 'string') {
      continue
    }
    const [hhmm, priceText, cumVolumeText, cumAmountText] = point.trim().split(/\s+/)
    if (!/^\d{4}$/.test(hhmm ?? '') || !isTradingMinute(hhmm)) {
      continue
    }
    const timestamp = parseCnBarTime(`${date}${hhmm}`)
    const price = Number(priceText)
    const cumVolume = Number(cumVolumeText)
    const cumAmount = Number(cumAmountText)
    if (!Number.isFinite(timestamp) || !Number.isFinite(price) || price <= 0) {
      continue
    }
    // 原始量统一换算为手（科创板除以 200，其余板块本身即手）
    const volume = Number.isFinite(cumVolume)
      ? Math.max(0, Math.round((cumVolume - prevCumVolume) / sharesPerLot))
      : 0
    // 累计额缺失（北交所）时留空，由均价计算回退近似
    const turnover = Number.isFinite(cumAmount) ? Math.max(0, cumAmount - prevCumAmount) : undefined
    if (Number.isFinite(cumVolume)) {
      prevCumVolume = cumVolume
    }
    if (Number.isFinite(cumAmount)) {
      prevCumAmount = cumAmount
    }
    bars.push({
      timestamp,
      open: Number.isFinite(prevPrice) && prevPrice > 0 ? prevPrice : price,
      high: price,
      low: price,
      close: price,
      volume,
      turnover
    })
    prevPrice = price
  }
  return bars
}

// 均价线：个股用官方累计成交额 / 累计成交量（手转股乘 lotSize），缺额时退回 close*volume 近似；
// 指数无每股价格语义（额/量约为全市场平均股价，与点位差两个数量级），
// 改用按量加权的指数点位均值，保证黄线贴合白线
export const calcTimeShareAvg = (dataList: KLineData[]): TimeShareDatum[] => {
  if (timeShareState.isIndex) {
    let pvSum = 0
    let volSum = 0
    return dataList.map(bar => {
      const volume = bar.volume ?? 0
      pvSum += bar.close * volume
      volSum += volume
      return { avg: volSum > 0 ? pvSum / volSum : bar.close }
    })
  }
  const lotSize = timeShareState.lotSize
  let amountSum = 0
  let volumeSum = 0
  return dataList.map(bar => {
    const volume = bar.volume ?? 0
    amountSum += bar.turnover ?? bar.close * volume * lotSize
    volumeSum += volume
    return { avg: volumeSum > 0 ? amountSum / (volumeSum * lotSize) : bar.close }
  })
}

const PERCENT_Y_AXIS_NAME = 'cnTimePercent'

// A 股一个交易日的分时分钟数：09:30-11:30 与 13:00-15:00 各 121 根
const TIME_SHARE_TOTAL_BARS = 242

// 分时 x 轴锚点：符合 A 股交易时段，午休处合并显示
interface TimeShareAnchor { hhmm: string; text: string; mergeNoon?: boolean }

const TIME_SHARE_X_ANCHORS: TimeShareAnchor[] = [
  { hhmm: '0930', text: '09:30' },
  { hhmm: '1030', text: '10:30' },
  { hhmm: '1130', text: '11:30/13:00', mergeNoon: true },
  { hhmm: '1400', text: '14:00' },
  { hhmm: '1500', text: '15:00' }
]

const percentOfPrevClose = (value: number): number => {
  const prevClose = timeShareState.prevClose
  return Number.isFinite(prevClose) && prevClose > 0 ? (value / prevClose - 1) * 100 : value
}

const priceOfPercent = (value: number): number => {
  const prevClose = timeShareState.prevClose
  return Number.isFinite(prevClose) && prevClose > 0 ? (value / 100 + 1) * prevClose : value
}

// 左侧涨跌幅轴：价格 <-> 昨收百分比
registerYAxis({
  name: PERCENT_Y_AXIS_NAME,
  realValueToDisplayValue: percentOfPrevClose,
  displayValueToRealValue: priceOfPercent,
  displayValueToText: value => `${value > 0 ? '+' : ''}${value.toFixed(2)}%`
})

const isEnLocale = () => window.location.hash.endsWith('#en-US')

// 分时均价指标（挂主图），draw 里额外绘制昨收基准虚线
registerIndicator<TimeShareDatum>({
  name: 'TIME',
  shortName: isEnLocale() ? 'Time' : '分时',
  series: 'price',
  calcParams: [],
  figures: [{
    key: 'avg',
    type: 'line',
    title: isEnLocale() ? 'Avg: ' : '均价: ',
    styles: () => ({ color: '#F5A623', size: 1 })
  }],
  calc: calcTimeShareAvg,
  draw: ({ ctx, chart, bounding, yAxis }) => {
    const prevClose = timeShareState.prevClose
    if (!Number.isFinite(prevClose) || prevClose <= 0) {
      return false
    }
    const y = yAxis.convertToPixel(prevClose)
    if (!Number.isFinite(y)) {
      return false
    }
    ctx.save()
    ctx.strokeStyle = chart.getStyles().grid.horizontal.color
    ctx.lineWidth = 1
    ctx.setLineDash([4, 3])
    ctx.beginPath()
    ctx.moveTo(bounding.left, y)
    ctx.lineTo(bounding.right, y)
    ctx.stroke()
    ctx.restore()
    return false
  }
})

// 覆盖内置 VOL：内置量柱红绿按「开 vs 收」判定，与 K 线（按昨收）在假阴/假阳
// 线时不同步；改为与前收比较，量柱颜色与 K 线红绿一致，符合 A 股软件习惯
registerIndicator<Record<string, number>, number>({
  name: 'VOL',
  shortName: 'VOL',
  series: 'volume',
  calcParams: [5, 10, 20],
  shouldFormatBigNumber: true,
  precision: 0,
  minValue: 0,
  regenerateFigures: (params: number[]): IndicatorFigure<Record<string, number>>[] => {
    const figures: IndicatorFigure<Record<string, number>>[] = params.map((p, i) => ({
      key: `ma${i + 1}`,
      title: `MA${p}: `,
      type: 'line'
    }))
    figures.push({
      key: 'volume',
      title: 'VOLUME: ',
      type: 'bar',
      baseValue: 0,
      styles: ({ data, defaultStyles }) => {
        const bars = (defaultStyles?.bars ?? []) as Array<{ upColor?: string; downColor?: string; noChangeColor?: string }>
        const current = data.current as { open?: number; close?: number } | null
        let color = bars[0]?.noChangeColor
        if (current != null && current.open != null && current.close != null) {
          if (current.close > current.open) {
            color = bars[0]?.upColor
          } else if (current.close < current.open) {
            color = bars[0]?.downColor
          }
        }
        return { color }
      }
    })
    return figures
  },
  calc: (dataList: KLineData[], indicator) => {
    const params = indicator.calcParams.length > 0 ? indicator.calcParams : [5, 10, 20]
    const volSums: number[] = []
    return dataList.map((bar, i) => {
      const volume = bar.volume ?? 0
      const vol: Record<string, number> = {
        volume,
        // 判定基准用前一根收盘（首根退回当日开盘），量柱红绿与 K 线同步
        open: dataList[i - 1]?.close ?? bar.open,
        close: bar.close
      }
      params.forEach((p, index) => {
        volSums[index] = (volSums[index] ?? 0) + volume
        if (i >= p - 1) {
          vol[`ma${index + 1}`] = volSums[index] / p
          volSums[index] -= dataList[i - (p - 1)]?.volume ?? 0
        }
      })
      return vol
    })
  }
})

// 覆盖内置 MA：tooltip 不再单独渲染（名称行与数值行均并入首行，
// 见下方 candle tooltip 模板），calc/figures 逻辑与库内置保持一致
registerIndicator<Record<string, number>, number>({
  name: 'MA',
  shortName: 'MA',
  series: 'price',
  calcParams: [5, 10, 30, 60],
  precision: 2,
  shouldOhlc: true,
  regenerateFigures: params => params.map((p, i) => ({
    key: `ma${i + 1}`,
    title: `MA${p}: `,
    type: 'line'
  })),
  calc: (dataList: KLineData[], indicator) => {
    const closeSums: number[] = []
    return dataList.map((kLineData, i) => {
      const ma: Record<string, number> = {}
      const close = kLineData.close
      indicator.calcParams.forEach((p, index) => {
        closeSums[index] = (closeSums[index] ?? 0) + close
        if (i >= p - 1) {
          ma[indicator.figures[index].key] = closeSums[index] / p
          closeSums[index] -= dataList[i - (p - 1)].close
        }
      })
      return ma
    })
  },
  createTooltipDataSource: () => ({
    name: '',
    calcParamsText: '',
    features: [],
    // 空数组：MA 名称与数值全部由 candle tooltip 模板并入首行，指标自身不再出图例
    legends: []
  })
})

// 换手率指标：成交量 / 流通股本 * 100%（需流通股本数据，暂用成交量近似）
registerIndicator<Record<string, number>>({
  name: 'TURNOVER',
  shortName: isEnLocale() ? 'Turnover' : '换手率',
  series: 'volume',
  calcParams: [],
  precision: 2,
  shouldFormatBigNumber: false,
  figures: [{
    key: 'turnoverRate',
    title: isEnLocale() ? 'Turnover Rate: ' : '换手率: ',
    type: 'bar',
    baseValue: 0,
    styles: () => ({ color: '#9B59B6' })
  }],
  calc: (dataList: KLineData[]) => {
    // 简化计算：使用相对换手率（实际应用中需传入流通股本）
    const maxVolume = Math.max(...dataList.map(d => d.volume ?? 0), 1)
    return dataList.map(bar => ({
      turnoverRate: ((bar.volume ?? 0) / maxVolume) * 100
    }))
  }
})

// 振幅指标：(最高价 - 最低价) / 昨收价 * 100%
registerIndicator<Record<string, number>>({
  name: 'AMPLITUDE',
  shortName: isEnLocale() ? 'Amplitude' : '振幅',
  series: 'volume',
  calcParams: [],
  precision: 2,
  shouldFormatBigNumber: false,
  figures: [{
    key: 'amplitude',
    title: isEnLocale() ? 'Amplitude: ' : '振幅: ',
    type: 'bar',
    baseValue: 0,
    styles: () => ({ color: '#E67E22' })
  }],
  calc: (dataList: KLineData[]) => {
    return dataList.map((bar, i) => {
      const prevClose = i > 0 ? dataList[i - 1].close : bar.open
      const high = bar.high ?? bar.close
      const low = bar.low ?? bar.close
      const amplitude = prevClose > 0 ? ((high - low) / prevClose) * 100 : 0
      return { amplitude }
    })
  }
})

// 基本面数据接口（从腾讯实时行情获取）
// 仅保留有历史意义或接口直供的指标；内盘/外盘/股本类无历史且K线算不出，已移除
interface FundamentalData {
  pe?: number        // 市盈率(TTM)
  peDynamic?: number // 动态市盈率
  peStatic?: number  // 静态市盈率
  pb?: number        // 市净率
  turnoverRate?: number   // 换手率(%)
  amplitude?: number      // 振幅(%)
  totalMarketCap?: number  // 总市值(元)
  floatMarketCap?: number  // 流通市值(元)
  avgPrice?: number        // 均价
}

// 缓存基本面数据
const fundamentalCache = new Map<string, FundamentalData>()

async function fetchFundamentalData (symbol: SymbolInfo): Promise<FundamentalData> {
  const cacheKey = `${symbol.market}${symbol.ticker}`
  if (fundamentalCache.has(cacheKey)) {
    return fundamentalCache.get(cacheKey)!
  }

  try {
    const code = `${symbol.market}${symbol.ticker}`

    // 使用腾讯实时行情接口获取完整数据
    const response = await fetch(`https://qt.gtimg.cn/q=${code}`)
    // 接口返回 GBK 编码，必须按 GBK 解码，否则中文乱码
    const buffer = await response.arrayBuffer()
    const text = new TextDecoder('gbk').decode(buffer)

    // 解析腾讯行情数据（格式：v_sh600519="1~贵州茅台~...~..."）
    const match = text.match(new RegExp(`${code}="([^"]+)`))
    if (!match) {
      console.warn('Failed to parse fundamental data for', code)
      return {}
    }

    const fields = match[1].split('~')

    // 腾讯 A 股行情字段表（已用新浪实测数据核对，sh600519）：
    // [1]  名称              [3]  现价        [4]  昨收
    // [7]  外盘(手)          [8]  内盘(手)
    // [30] 时间戳(如 20260916110501，勿当数值用!)
    // [38] 换手率(%)         [39] 市盈率TTM
    // [43] 振幅(%)           [44] 流通市值(亿)  [45] 总市值(亿)
    // [46] 市净率            [51] 均价        [52] 市盈率(动)  [53] 市盈率(静)
    const parseNum = (val: string | undefined): number | undefined => {
      if (val == null || val === '-' || val === '') return undefined
      const num = Number(val.replace(/,/g, ''))
      // 允许负值（亏损股市盈率为负），仅排除 0 和 NaN
      return Number.isFinite(num) && num !== 0 ? num : undefined
    }

    const totalCapYi = parseNum(fields[45])
    const floatCapYi = parseNum(fields[44])

    const data: FundamentalData = {
      turnoverRate: parseNum(fields[38]),
      amplitude: parseNum(fields[43]),
      pe: parseNum(fields[39]),          // 市盈率 TTM
      peDynamic: parseNum(fields[52]),
      peStatic: parseNum(fields[53]),
      pb: parseNum(fields[46]),
      totalMarketCap: totalCapYi != null ? totalCapYi * 1e8 : undefined,
      floatMarketCap: floatCapYi != null ? floatCapYi * 1e8 : undefined,
      avgPrice: parseNum(fields[51])
    }

    fundamentalCache.set(cacheKey, data)
    return data
  } catch (error) {
    console.error('Error fetching fundamental data:', error)
    return {}
  }
}

// 清除指定标的的基本面缓存（用于强制刷新）
export const clearFundamentalCache = (symbol?: SymbolInfo): void => {
  if (symbol) {
    const cacheKey = `${symbol.market}${symbol.ticker}`
    fundamentalCache.delete(cacheKey)
    console.log('Cleared fundamental cache for', cacheKey)
  } else {
    fundamentalCache.clear()
    console.log('Cleared all fundamental cache')
  }
}

// 当前标的基本面快照（供十字光标联动回溯显示）
let latestFundamental: FundamentalData = {}

// 信息表格整体重渲染回调（app 初始化时注入，基本面异步加载完成后触发刷新）
let infoTableRender: ((hovered: KLineData | null) => void) | undefined

// 生成基本面指标（键控结构，供信息表格与 K 线行情混排）。
// 未悬停（含最后一根）显示接口原值；悬停历史 K 线时：
// - 振幅/换手率：由 K 线精确重算
// - 市盈/市净/市值/均价：按 收盘价比例 回溯（假设股本与财务数据不变，近似值）
const buildFundamentalItems = (
  data: FundamentalData,
  locale: string,
  hovered: KLineData | null,
  dataList: KLineData[]
): Record<string, { label: string; value: string }> => {
  const t = (zhEn: string) => {
    const [zh, en] = zhEn.split('|')
    return locale === 'en-US' ? en : zh
  }

  // 格式化函数（智能单位转换）
  const fmt = (value: number | undefined, precision: number = 2, preferredUnit?: string): string => {
    if (value == null || !Number.isFinite(value)) return '--'

    // 如果指定了首选单位
    if (preferredUnit === '亿') {
      if (Math.abs(value) >= 1e8) return `${(value / 1e8).toFixed(precision)}亿`
      if (Math.abs(value) >= 1e4) return `${(value / 1e4).toFixed(precision)}万`
      return value.toFixed(precision)
    }

    if (preferredUnit === '万') {
      if (Math.abs(value) >= 1e4) return `${(value / 1e4).toFixed(precision)}万`
      return value.toFixed(precision)
    }

    // 自动智能格式化（无指定单位时）
    if (Math.abs(value) >= 1e12) return `${(value / 1e12).toFixed(precision)}万亿`
    if (Math.abs(value) >= 1e8) return `${(value / 1e8).toFixed(precision)}亿`
    if (Math.abs(value) >= 1e4) return `${(value / 1e4).toFixed(precision)}万`
    return value.toFixed(precision)
  }

  let view = data
  const idx = hovered != null ? dataList.indexOf(hovered) : -1
  if (hovered != null && idx >= 0 && idx < dataList.length - 1) {
    const last = dataList[dataList.length - 1]
    const priceRatio = last.close !== 0 ? hovered.close / last.close : 1
    const volumeRatio = (last.volume ?? 0) !== 0 ? (hovered.volume ?? 0) / (last.volume ?? 0) : 1
    // 昨收：取前一根收盘；首根在分时下用基准昨收，否则用自身开盘
    const prevClose = idx > 0
      ? dataList[idx - 1].close
      : (timeShareState.active && Number.isFinite(timeShareState.prevClose) ? timeShareState.prevClose : hovered.open)
    const scale = (v?: number) => (v != null ? v * priceRatio : undefined)
    view = {
      ...data,
      turnoverRate: data.turnoverRate != null ? data.turnoverRate * volumeRatio : undefined,
      amplitude: prevClose !== 0 ? Math.abs((hovered.high - hovered.low) / prevClose) * 100 : undefined,
      pe: scale(data.pe),
      peDynamic: scale(data.peDynamic),
      peStatic: scale(data.peStatic),
      pb: scale(data.pb),
      totalMarketCap: scale(data.totalMarketCap),
      floatMarketCap: scale(data.floatMarketCap),
      avgPrice: scale(data.avgPrice)
    }
  }

  return {
    turnover: { label: t('换手率|Turnover'), value: fmt(view.turnoverRate) + (view.turnoverRate != null ? '%' : '') },
    amplitude: { label: t('振幅|Amplitude'), value: fmt(view.amplitude) + (view.amplitude != null ? '%' : '') },
    pe: { label: t('市盈|PE(TTM)'), value: fmt(view.pe) },
    peDynamic: { label: t('市盈动|PE(D)'), value: fmt(view.peDynamic) },
    peStatic: { label: t('市盈静|PE(S)'), value: fmt(view.peStatic) },
    pb: { label: t('市净率|PB'), value: fmt(view.pb) },
    totalMarketCap: { label: t('总市值|Total Cap'), value: fmt(view.totalMarketCap, 2, '亿') },
    floatMarketCap: { label: t('流通市值|Float Cap'), value: fmt(view.floatMarketCap, 2, '亿') },
    avgPrice: { label: t('均价|Avg Price'), value: fmt(view.avgPrice) }
  }
}

// 拉取基本面数据并触发信息表格整体刷新
export const updateFundamentalBar = async (
  symbol: SymbolInfo,
  forceRefresh: boolean = false // 是否强制刷新
): Promise<void> => {
  try {
    // 如果需要强制刷新，先清除缓存
    if (forceRefresh) {
      clearFundamentalCache(symbol)
    }
    const data = await fetchFundamentalData(symbol)
    latestFundamental = data
  } catch (error) {
    console.error('Failed to update fundamental bar:', error)
  } finally {
    // 拉取完成（含失败，失败时指标显示 --）后整体重渲染信息表格
    infoTableRender?.(null)
  }
}

// 以昨收为中心的对称区间，保证基准线位于面板中线
export const symmetricRangeAround = (base: number, defaultRange: AxisRange): AxisRange => {
  if (!Number.isFinite(base) || base <= 0) {
    return defaultRange
  }
  const half = Math.max(Math.abs(defaultRange.from - base), Math.abs(defaultRange.to - base))
  const safeHalf = half > 0 ? half : base * 0.01
  return {
    from: base - safeHalf,
    to: base + safeHalf,
    range: safeHalf * 2,
    realFrom: base - safeHalf,
    realTo: base + safeHalf,
    realRange: safeHalf * 2,
    displayFrom: base - safeHalf,
    displayTo: base + safeHalf,
    displayRange: safeHalf * 2
  }
}

async function fetchCnPrevClose (symbol: SymbolInfo, displayedDayKey: string, fallback: number): Promise<number> {
  const code = `${symbol.market}${symbol.ticker}`
  try {
    const response = await fetch(`https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=${code},day,,,6,`)
    const result = await response.json()
    const container = result?.data?.[code] ?? {}
    const days = parseTencentKlines(container?.day ?? [])
    if (days.length > 0) {
      return pickPrevClose(days, displayedDayKey, fallback)
    }
    // 日线缺失时退回 qt 实时数据，索引 4 为昨收
    const qt = container?.qt?.[code]
    if (Array.isArray(qt) && Number(qt[4]) > 0) {
      return Number(qt[4])
    }
    return fallback
  } catch {
    return fallback
  }
}

export interface TimeShareSnapshot {
  date: string
  prevClose: number
  bars: KLineData[]
}

// 官方分时接口：一次返回最新交易日每分钟价格、累计量/额与昨收（qt 索引 4）
async function fetchCnTimeShare (symbol: SymbolInfo): Promise<TimeShareSnapshot> {
  const code = `${symbol.market}${symbol.ticker}`
  const star = isCnStarMarket(symbol)
  // 科创板分时量为「股」（每手 200 股），其余板块为「手」（每手 100 股）
  timeShareState.lotSize = star ? 200 : 100
  // 指数标记：均价线与个股口径不同
  timeShareState.isIndex = isCnIndex(symbol)
  const response = await fetch(`https://web.ifzq.gtimg.cn/appstock/app/day/query?code=${code}`)
  const result = await response.json()
  const container = result?.data?.[code] ?? {}
  const qt = container?.qt?.[code]
  const prevCloseFromQt = Array.isArray(qt) ? Number(qt[4]) : Number.NaN
  const days: unknown[] = container?.data ?? []
  let best: { date: string; points: unknown[] } | null = null
  for (const day of days) {
    const date = (day as { date?: unknown })?.date
    const points = (day as { data?: unknown })?.data
    if (typeof date === 'string' && /^\d{8}$/.test(date) && Array.isArray(points)) {
      // data 数组最新在前，取日期最大的一支
      if (best == null || date > best.date) {
        best = { date, points }
      }
    }
  }
  if (best == null) {
    throw new Error('time share data is empty')
  }
  const fallbackPrice = Number.isFinite(prevCloseFromQt) && prevCloseFromQt > 0
    ? prevCloseFromQt
    : Number.NaN
  const bars = parseTimeShareDay(best.date, best.points, fallbackPrice, star ? 200 : 1)
  if (bars.length === 0) {
    throw new Error('time share points are invalid')
  }
  let prevClose = fallbackPrice
  if (!Number.isFinite(prevClose) || prevClose <= 0) {
    prevClose = await fetchCnPrevClose(
      symbol,
      localDayKey(parseCnBarTime(`${best.date}0930`)),
      bars[0].close
    )
  }
  return { date: best.date, prevClose, bars }
}

interface PeriodOption { key: string; span: number; type: Period['type']; text: string }

const PERIOD_OPTIONS: PeriodOption[] = [
  { key: '1m', span: 1, type: 'minute', text: '1分|1m' },
  { key: '5m', span: 5, type: 'minute', text: '5分|5m' },
  { key: '15m', span: 15, type: 'minute', text: '15分|15m' },
  { key: '30m', span: 30, type: 'minute', text: '30分|30m' },
  { key: '1h', span: 1, type: 'hour', text: '1时|1h' },
  { key: '4h', span: 4, type: 'hour', text: '4时|4h' },
  { key: '1d', span: 1, type: 'day', text: '日|1D' },
  { key: '1w', span: 1, type: 'week', text: '周|1W' },
  { key: '1M', span: 1, type: 'month', text: '月|1M' }
]

const MAIN_INDICATORS = ['MA', 'EMA', 'SMA', 'BOLL', 'SAR', 'BBI']

const SUB_INDICATORS = [
  'VOL', 'MACD', 'KDJ', 'RSI', 'BIAS', 'CCI', 'WR', 'DMI',
  'OBV', 'PSY', 'DMA', 'EMV', 'ROC', 'TRIX', 'VR', 'MTM',
  'TURNOVER', 'AMPLITUDE'
]

interface DrawingTool { name: string; text: string }

const DRAWING_TOOLS: DrawingTool[] = [
  { name: 'straightLine', text: '直线|Line' },
  { name: 'segment', text: '线段|Segment' },
  { name: 'rayLine', text: '射线|Ray' },
  { name: 'horizontalStraightLine', text: '水平线|Horizontal Line' },
  { name: 'verticalStraightLine', text: '垂直线|Vertical Line' },
  { name: 'priceLine', text: '价格线|Price Line' },
  { name: 'priceChannelLine', text: '价格通道线|Price Channel' },
  { name: 'parallelStraightLine', text: '平行直线|Parallel Line' },
  { name: 'fibonacciLine', text: '斐波那契回调线|Fibonacci' },
  { name: 'brush', text: '画笔|Brush' },
  { name: 'simpleAnnotation', text: '注释|Annotation' }
]

interface IndicatorParamMeta { label: string; min: number; decimal?: boolean }

const INDICATOR_PARAM_META: Record<string, IndicatorParamMeta[]> = {
  MA: [
    { label: 'MA1', min: 1 }, { label: 'MA2', min: 1 },
    { label: 'MA3', min: 1 }, { label: 'MA4', min: 1 }, { label: 'MA5', min: 1 }
  ],
  EMA: [
    { label: 'EMA1', min: 1 }, { label: 'EMA2', min: 1 },
    { label: 'EMA3', min: 1 }, { label: 'EMA4', min: 1 }, { label: 'EMA5', min: 1 }
  ],
  SMA: [
    { label: '周期|Period', min: 1 }, { label: '权重|Weight', min: 1 }
  ],
  BOLL: [
    { label: '周期|Period', min: 1 }, { label: '标准差|Std Dev', min: 0.1, decimal: true }
  ],
  SAR: [
    { label: '步长|Step', min: 0.01, decimal: true },
    { label: '加速因子|Factor', min: 0.01, decimal: true },
    { label: '极值|Max', min: 1 }
  ],
  BBI: [
    { label: '参数 1|Param 1', min: 1 }, { label: '参数 2|Param 2', min: 1 },
    { label: '参数 3|Param 3', min: 1 }, { label: '参数 4|Param 4', min: 1 }
  ],
  VOL: [
    { label: 'MA1', min: 1 }, { label: 'MA2', min: 1 },
    { label: 'MA3', min: 1 }, { label: 'MA4', min: 1 }, { label: 'MA5', min: 1 }
  ],
  MACD: [
    { label: '快线|Fast', min: 1 }, { label: '慢线|Slow', min: 1 }, { label: '信号|Signal', min: 1 }
  ],
  KDJ: [
    { label: '周期|Period', min: 1 }, { label: 'K', min: 1 }, { label: 'D', min: 1 }
  ],
  RSI: [
    { label: 'RSI1', min: 1 }, { label: 'RSI2', min: 1 }, { label: 'RSI3', min: 1 },
    { label: 'RSI4', min: 1 }, { label: 'RSI5', min: 1 }
  ],
  BIAS: [
    { label: 'BIAS1', min: 1 }, { label: 'BIAS2', min: 1 }, { label: 'BIAS3', min: 1 },
    { label: 'BIAS4', min: 1 }, { label: 'BIAS5', min: 1 }
  ],
  CCI: [{ label: '周期|Period', min: 1 }],
  WR: [
    { label: 'WR1', min: 1 }, { label: 'WR2', min: 1 }, { label: 'WR3', min: 1 },
    { label: 'WR4', min: 1 }, { label: 'WR5', min: 1 }
  ],
  DMI: [{ label: '周期|Period', min: 1 }, { label: '平滑|Smooth', min: 1 }],
  OBV: [{ label: '周期|Period', min: 1 }],
  PSY: [{ label: '周期|Period', min: 1 }, { label: 'MA|MA', min: 1 }],
  DMA: [
    { label: '快线|Fast', min: 1 }, { label: '慢线|Slow', min: 1 }, { label: 'MA|MA', min: 1 }
  ],
  EMV: [{ label: '周期|Period', min: 1 }, { label: 'MA|MA', min: 1 }],
  ROC: [{ label: '周期|Period', min: 1 }, { label: 'MA|MA', min: 1 }],
  TRIX: [{ label: '周期|Period', min: 1 }, { label: 'MA|MA', min: 1 }],
  VR: [{ label: '周期|Period', min: 1 }, { label: 'MA|MA', min: 1 }],
  MTM: [{ label: '周期|Period', min: 1 }, { label: 'MA|MA', min: 1 }]
}

interface SymbolSearchItem { ticker: string; name: string; market: string }

// ==================== A股数据源（腾讯行情） ====================

const CN_TENCENT_PERIOD: Record<string, string> = {
  '1m': 'm1', '5m': 'm5', '15m': 'm15', '30m': 'm30', '1h': 'm60',
  '1d': 'day', '1w': 'week', '1M': 'month'
}

const PERIOD_KEY_PREFIX: Record<Period['type'], string> = {
  second: 's', minute: 'm', hour: 'h', day: 'd', week: 'w', month: 'M', year: 'y'
}

export const cnPeriodKey = (period: Period): string => `${period.span}${PERIOD_KEY_PREFIX[period.type]}`

export const guessCnMarket = (code: string): string => {
  if (/^(60|68|900)/.test(code)) return 'sh'
  if (/^(43|83|87|88|92)/.test(code)) return 'bj'
  if (/^(00|20|30)/.test(code)) return 'sz'
  return 'sz'
}

export const parseCnBarTime = (value: string): number => {
  if (value.includes('-')) {
    // 补全时间部分，避免纯日期被按 UTC 解析（需与分钟线一致按本地时区）
    const normalized = value.includes(':') ? value.replace(' ', 'T') : `${value}T00:00:00`
    return new Date(normalized).getTime()
  }
  if (/^\d{12}$/.test(value)) {
    return new Date(`${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}T${value.slice(8, 10)}:${value.slice(10, 12)}`).getTime()
  }
  if (/^\d{8}$/.test(value)) {
    return new Date(`${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}T00:00:00`).getTime()
  }
  return Number.NaN
}

export const parseTencentKlines = (rows: unknown[]): KLineData[] => rows
  .map((row): KLineData | null => {
    if (!Array.isArray(row) || row.length < 6) {
      return null
    }
    const timestamp = parseCnBarTime(String(row[0]))
    if (Number.isNaN(timestamp)) {
      return null
    }
    // 腾讯顺序：时间, 开, 收, 高, 低, 量
    return {
      timestamp,
      open: Number(row[1]),
      close: Number(row[2]),
      high: Number(row[3]),
      low: Number(row[4]),
      volume: Number(row[5])
    }
  })
  .filter((d): d is KLineData => d != null)

export const aggregateBars = (dataList: KLineData[], spanMillis: number): KLineData[] => {
  const buckets = new Map<number, KLineData>()
  for (const bar of dataList) {
    const key = Math.floor(bar.timestamp / spanMillis) * spanMillis
    const prev = buckets.get(key)
    if (prev == null) {
      buckets.set(key, { ...bar, timestamp: key })
    } else {
      prev.high = Math.max(prev.high, bar.high)
      prev.low = Math.min(prev.low, bar.low)
      prev.close = bar.close
      prev.volume = (prev.volume ?? 0) + (bar.volume ?? 0)
      prev.turnover = (prev.turnover ?? 0) + (bar.turnover ?? 0)
    }
  }
  return Array.from(buckets.values()).sort((a, b) => a.timestamp - b.timestamp)
}

async function fetchCnSymbolName (market: string, ticker: string): Promise<{ name: string | null; invalid: boolean }> {
  const code = `${market}${ticker}`
  try {
    // 使用腾讯实时行情接口获取股票名称
    const response = await fetch(`https://qt.gtimg.cn/q=${code}`)
    const buffer = await response.arrayBuffer()
    // 腾讯接口返回 GBK 编码，需要转换
    const decoder = new TextDecoder('gbk')
    const text = decoder.decode(buffer)

    // 解析数据格式：v_sh600519="1~贵州茅台~600519~..."
    const match = text.match(new RegExp(`${code}="([^"]+)`))
    if (match) {
      const fields = match[1].split('~')
      // 字段 [1] 是股票名称
      if (fields.length > 1 && fields[1] !== '' && fields[1] !== '-') {
        return { name: fields[1], invalid: false }
      }
    }
    return { name: null, invalid: true }
  } catch {
    return { name: null, invalid: false }
  }
}

const formatTencentDate = (timestamp: number): string => {
  const date = new Date(timestamp)
  const month = `${date.getMonth() + 1}`.padStart(2, '0')
  const day = `${date.getDate()}`.padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

async function fetchCnKLineData (symbol: SymbolInfo, period: Period, from: number, to: number): Promise<KLineData[]> {
  const key = CN_TENCENT_PERIOD[cnPeriodKey(period)]
  let periodKey = key
  let aggregateMillis: number | null = null
  if (key == null) {
    // 腾讯不支持的周期（如 4 时）用 60 分钟线拉取后本地聚合
    periodKey = period.type === 'hour' ? 'm60' : 'day'
    aggregateMillis = period.span * TIMESPAN_MILLIS[period.type]
  }
  const code = `${symbol.market}${symbol.ticker}`
  // 腾讯接口带 end 日期时会漏掉"当天"这根 bar（end 写成未来日期也一样），窗口覆盖今天时 end 必须留空
  const endParam = formatTencentDate(to) === formatTencentDate(Date.now()) ? '' : formatTencentDate(to)
  // 分钟线接口仅支持 m1/m5/m15/m30/m60；用 /^m\d/ 匹配，避免 'month' 误入分钟接口
  const url = /^m\d/.test(periodKey)
    ? `https://ifzq.gtimg.cn/appstock/app/kline/mkline?param=${code},${periodKey},,640`
    : `https://ifzq.gtimg.cn/appstock/app/fqkline/get?param=${code},${periodKey},${formatTencentDate(from)},${endParam},640,qfq`

  // 腾讯接口自身返回 CORS 允许头，浏览器可直接跨域访问
  const response = await fetch(url)
  const result = await response.json()
  const container = result?.data?.[code] ?? {}
  const rows: unknown[] = container[`qfq${periodKey}`] ?? container[periodKey] ?? []
  let dataList = parseTencentKlines(rows)
    .filter(d => d.timestamp >= from && d.timestamp <= to)
    .slice(-BAR_LIMIT)
  if (aggregateMillis != null) {
    dataList = aggregateBars(dataList, aggregateMillis)
  }
  return dataList
}

async function searchCnSymbols (query: string): Promise<SymbolSearchItem[]> {
  // smartbox 无 CORS 头，仅支持代码匹配，名称通过 ifzq 的 qt 实时数据补全
  const codeMatch = query.match(/^(sh|sz|bj)?(\d{6})$/i)
  if (codeMatch == null) {
    return []
  }
  const market = (codeMatch[1] ?? guessCnMarket(codeMatch[2])).toLowerCase()
  const ticker = codeMatch[2]
  const { name, invalid } = await fetchCnSymbolName(market, ticker)
  if (invalid) {
    return []
  }
  return [{ ticker, name: name ?? ticker, market }]
}

const DEFAULT_SYMBOLS: SymbolSearchItem[] = [
  { ticker: '000001', name: '上证指数', market: 'sh' },
  { ticker: '399001', name: '深证成指', market: 'sz' },
  { ticker: '399006', name: '创业板指', market: 'sz' },
  { ticker: '000300', name: '沪深300', market: 'sh' },
  { ticker: '000688', name: '科创50', market: 'sh' },
  { ticker: '000905', name: '中证500', market: 'sh' }
]

export default function setupApp (root: HTMLDivElement) {
  const locale = window.location.hash.endsWith('#en-US') ? 'en-US' : 'zh-CN'
  const t = (zhEn: string) => {
    const [zh, en] = zhEn.split('|')
    return locale === 'zh-CN' ? zh : en
  }

  root.innerHTML = `
    <div class="toolbar">
      <div class="toolbar-item">
        <button class="tb-btn tb-symbol" id="symbol-btn">上证指数</button>
        <div class="dropdown symbol-dropdown" id="symbol-dropdown">
          <div class="search-box">
            <input class="symbol-search-input" id="symbol-search-input" placeholder="${t('搜索标的（输入6位代码）|Search (6-digit code)')}"/>
            <button class="search-clear-btn" id="search-clear-btn" type="button" title="${t('清空|Clear')}">×</button>
          </div>
          <div class="symbol-list" id="symbol-list"></div>
        </div>
      </div>
      <div class="tb-divider"></div>
      <div class="toolbar-item period-group" id="period-group"></div>
      <div class="tb-divider"></div>
      <div class="toolbar-item">
        <button class="tb-btn tb-dd" id="main-indicator-btn">${t('主图指标|Main Indicators')}</button>
        <div class="dropdown indicator-dropdown" id="main-indicator-dropdown"></div>
      </div>
      <div class="toolbar-item">
        <button class="tb-btn tb-dd" id="sub-indicator-btn">${t('副图指标|Sub Indicators')}</button>
        <div class="dropdown indicator-dropdown" id="sub-indicator-dropdown"></div>
      </div>
      <div class="toolbar-item" style="display: none;">
        <button class="tb-btn" id="indicator-setting-btn">${t('指标设置|Indicator Settings')}</button>
      </div>
      <div class="toolbar-item">
        <button class="tb-btn tb-dd" id="drawing-btn">${t('绘图|Drawing')}</button>
        <div class="dropdown drawing-dropdown" id="drawing-dropdown"></div>
      </div>
      <div class="toolbar-item">
        <button class="tb-btn tb-clear" id="clear-btn">${t('清除绘图|Clear Drawings')}</button>
      </div>
      <div class="toolbar-item">
        <button class="tb-btn tb-theme" id="theme-btn" type="button" title="${t('切换主题|Toggle theme')}">
          <span class="theme-switch" aria-hidden="true">
            <svg class="sw-icon sw-sun" viewBox="0 0 24 24"><path d="M6.76 4.84l-1.8-1.79-1.41 1.41 1.79 1.79 1.42-1.41zM4 10.5H1v2h3v-2zm9-9.95h-2V3.5h2V.55zm7.45 3.91l-1.41-1.41-1.79 1.79 1.41 1.41 1.79-1.79zm-3.21 13.7l1.79 1.8 1.41-1.41-1.8-1.79-1.4 1.4zM20 10.5v2h3v-2h-3zm-8-5c-3.31 0-6 2.69-6 6s2.69 6 6 6 6-2.69 6-6-2.69-6-6-6zm-1 16.95h2V19.5h-2v2.95zm-7.45-3.91l1.41 1.41 1.79-1.8-1.41-1.41-1.79 1.8z"/></svg>
            <svg class="sw-icon sw-moon" viewBox="0 0 24 24"><path d="M12 3a9 9 0 1 0 9 9c0-.46-.04-.92-.1-1.36a5.389 5.389 0 0 1-4.4 2.26 5.403 5.403 0 0 1-3.14-9.8c-.44-.06-.9-.1-1.36-.1z"/></svg>
            <span class="theme-knob"></span>
          </span>
        </button>
      </div>
    </div>
    <!-- 信息表格：K线行情 + 基本面混排（PC 2 行 / 移动端 4 行），随十字光标联动 -->
    <div class="info-table" id="info-table">
      <div class="fundamental-loading">${t('加载中...|Loading...')}</div>
    </div>
    <div id="container">
      <div class="watermark">${LOGO_SVG}</div>
    </div>
    <div class="modal-mask" id="indicator-modal">
      <div class="modal">
        <div class="modal-header">
          <span class="modal-title">${t('指标设置|Indicator Settings')}</span>
          <button class="modal-close" id="indicator-modal-close">×</button>
        </div>
        <div class="modal-body">
          <select class="tb-select modal-select" id="indicator-select"></select>
          <div class="param-list" id="param-list"></div>
        </div>
        <div class="modal-footer">
          <button class="tb-btn modal-btn" id="indicator-modal-cancel">${t('取消|Cancel')}</button>
          <button class="tb-btn modal-btn primary" id="indicator-modal-confirm">${t('确定|OK')}</button>
        </div>
      </div>
    </div>
  `

  const chart = init('container', { locale, timezone: 'Asia/Shanghai' })
  if (!chart) {
    return
  }

  let cnPollTimer: ReturnType<typeof setInterval> | undefined

  const stopCnPolling = () => {
    if (cnPollTimer != null) {
      clearInterval(cnPollTimer)
      cnPollTimer = undefined
    }
  }

  const dataLoader: DataLoader = {
    getBars: async ({ type, timestamp, symbol, period, callback }) => {
      // 分时：官方分时接口一次返回当日分钟数据与昨收基准
      if (timeShareState.active) {
        // 当日数据 init 时已全量，历史与增量均无更多（更新由轮询承担）。
        // backward 若返回数据且 more=true，会与 setOffsetRightDistance(0)
        // 联动反复触发 _adjustVisibleRange -> backward 加载，造成死循环
        if (type !== 'init') {
          callback([], { forward: false, backward: false })
          return
        }
        try {
          const snapshot = await fetchCnTimeShare(symbol)
          if (!timeShareState.active) {
            // 加载期间已切走周期，放弃注入避免清掉新周期的图
            callback([], false)
            return
          }
          timeShareState.dayKey = snapshot.date
          timeShareState.prevClose = snapshot.prevClose
          // 数据就绪：形态切换、数据注入、全天一屏校准在同一帧完成，
          // 旧图直接替换为最终分时布局（callback 前 prevClose 已就绪，
          // 百分比左轴首次布局即为最终宽度）
          applyTimeShareTransforms()
          callback(snapshot.bars, false)
          calibrateTimeShareFit(snapshot.bars.length)
          // 轮询首次更新后的复校仅作宽度变化兜底，宽度未变时为空操作
          fitTimeShareBars(snapshot.bars.length)
        } catch {
          if (timeShareState.active) {
            // 失败也切到分时形态，与普通周期加载失败后的空网格表现一致，
            // 轮询订阅随后建立可继续补数
            applyTimeShareTransforms()
          }
          callback([], false)
        }
        return
      }
      const spanMillis = period.span * TIMESPAN_MILLIS[period.type]
      let to = Date.now()
      let from = to - BAR_LIMIT * spanMillis
      // klinecharts v10 语义：forward = timestamp 取最旧 bar，加载更早历史；backward = timestamp 取最新 bar，加载更新数据
      if (type === 'forward' && timestamp != null) {
        to = timestamp - 1
        from = to - BAR_LIMIT * spanMillis
      } else if (type === 'backward' && timestamp != null) {
        from = timestamp + 1
      }
      try {
        const dataList = await fetchCnKLineData(symbol, period, from, to)
        if (type === 'forward') {
          callback(dataList, { forward: dataList.length > 0 })
        } else if (type === 'backward') {
          callback(dataList, { backward: dataList.length > 0 })
        } else {
          callback(dataList, true)
        }
      } catch {
        callback([], false)
      }
    },
    subscribeBar: ({ symbol, period, callback }) => {
      // A股无免费浏览器 WebSocket 行情，用腾讯 K 线接口轮询最新一根 bar
      stopCnPolling()
      // 快照订阅时的分时状态：切换分时/周期后，旧订阅在途的轮询结果不再
      // 注入，避免把分时 bar 追加到过渡期的旧图或新周期图表上
      const pollTimeShare = timeShareState.active
      let lastPolled: KLineData | null = null
      const emitIfChanged = (last: KLineData) => {
        // 最新一根未变化时跳过，避免每 3 秒无意义重绘
        if (lastPolled != null &&
          lastPolled.timestamp === last.timestamp &&
          lastPolled.close === last.close &&
          lastPolled.volume === last.volume) {
          return
        }
        const isFirstEmit = lastPolled == null
        lastPolled = last
        callback(last)
        if (isFirstEmit && pollTimeShare && timeShareState.active && pendingTimeShareFit > 0) {
          const count = pendingTimeShareFit
          pendingTimeShareFit = 0
          // 首次更新后复校一次：兜底刻度重建导致左轴宽度变化的场景，
          // 宽度未变时为空操作，不会引发可见跳动
          window.setTimeout(() => { calibrateTimeShareFit(count) }, 0)
        }
      }
      const poll = async () => {
        try {
          if (pollTimeShare !== timeShareState.active) {
            // 订阅过期：分时/周期状态已切换，停止注入本订阅的数据
            return
          }
          if (pollTimeShare) {
            const snapshot = await fetchCnTimeShare(symbol)
            if (timeShareState.dayKey != null && snapshot.date !== timeShareState.dayKey) {
              // 跨交易日：整体重载切换到新的一天（含昨收刷新）
              chart.setPeriod({ span: 1, type: 'minute' })
              return
            }
            const last = snapshot.bars[snapshot.bars.length - 1]
            if (last != null) {
              emitIfChanged(last)
            }
            return
          }
          const spanMillis = period.span * TIMESPAN_MILLIS[period.type]
          const dataList = await fetchCnKLineData(symbol, period, Date.now() - spanMillis * 20, Date.now())
          const last = dataList[dataList.length - 1]
          if (last != null) {
            emitIfChanged(last)
          }
        } catch {
          // 忽略单次轮询失败
        }
      }
      void poll()
      cnPollTimer = setInterval(() => { void poll() }, 3000)
    },
    unsubscribeBar: () => {
      stopCnPolling()
    }
  }

  chart.setDataLoader(dataLoader)
  // 默认展示上证指数（与默认标的列表一致）
  const DEFAULT_INIT_SYMBOL: SymbolInfo = { ticker: '000001', pricePrecision: 2, volumePrecision: 0, market: 'sh' }
  chart.setSymbol(DEFAULT_INIT_SYMBOL)

  // 初始加载基本面数据（完成后经 infoTableRender 回调刷新信息表格）
  void updateFundamentalBar(DEFAULT_INIT_SYMBOL)

  chart.setPeriod({ span: 1, type: 'day' })

  // ---------------- A 股配色（红涨绿跌，按昨收判定） ----------------

  const CN_UP_COLOR = '#ef2323'
  const CN_DOWN_COLOR = '#14a143'

  const applyCnColorScheme = () => {
    // klinecharts 默认为美股式绿涨红跌（按今开比较），不符合 A 股习惯
    chart.setStyles({
      candle: {
        bar: {
          compareRule: 'previous_close',
          upColor: CN_UP_COLOR,
          downColor: CN_DOWN_COLOR,
          upBorderColor: CN_UP_COLOR,
          downBorderColor: CN_DOWN_COLOR,
          upWickColor: CN_UP_COLOR,
          downWickColor: CN_DOWN_COLOR
        },
        priceMark: {
          last: {
            upColor: CN_UP_COLOR,
            downColor: CN_DOWN_COLOR
          }
        }
      },
      indicator: {
        bars: [{
          upColor: CN_UP_COLOR,
          downColor: CN_DOWN_COLOR
        }]
      }
    })
  }
  applyCnColorScheme()

  // 时间/开/高/低/收/量 已移至顶部 K 线信息栏，图上 tooltip 不再重复显示，
  // 仅保留 MA 均线数值（颜色与图上均线一致，格式化与库默认一致：精度 + 千分位 + 小数折叠）。
  // 数值实时取自主图 MA 当前状态（设置弹窗改参数、分时移除 MA 时自动跟随）
  const candleTooltipLegendTemplate: CandleTooltipLegendsCustomCallback = (data): TooltipLegend[] => {
    const legends: TooltipLegend[] = []
    const ma = chart.getIndicators({ paneId: 'candle_pane', name: 'MA' })[0]
    if (ma != null && ma.calcParams.length > 0) {
      const dataIndex = data.current != null ? chart.getDataList().indexOf(data.current) : -1
      const row = (ma.result[dataIndex] ?? {}) as Record<string, number>
      const lineStyles = chart.getStyles().indicator.lines
      const thousands = chart.getThousandsSeparator()
      const decimalFold = chart.getDecimalFold()
      ma.figures.forEach((figure, i) => {
        const color = lineStyles[i % lineStyles.length]?.color ?? ''
        const value = row[figure.key]
        const text = Number.isFinite(value)
          ? decimalFold.format(thousands.format(value.toFixed(ma.precision)))
          : 'n/a'
        legends.push({
          title: { text: figure.title ?? '', color },
          value: { text, color }
        })
      })
    }
    return legends
  }
  chart.setStyles({
    candle: {
      tooltip: {
        // 隐藏首行「股票代码 · 周期」标题行
        title: { show: false },
        legend: {
          template: candleTooltipLegendTemplate
        }
      }
    }
  })

  const mainIndicatorState = new Set(['MA'])
  const subIndicatorState = new Set(['VOL', 'MACD'])
  mainIndicatorState.forEach(name => { chart.createIndicator({ name, paneId: 'candle_pane' }, true) })
  subIndicatorState.forEach(name => { chart.createIndicator({ name }) })

  // ---------------- 信息表格（K线行情 + 基本面混排，随十字光标联动） ----------------

  const infoTable = root.querySelector<HTMLDivElement>('#info-table')!
  const CN_FLAT_COLOR = '#8ca0b3'

  const formatVolumeText = (volume: number): string => {
    const abs = Math.abs(volume)
    if (abs >= 1e8) return `${(volume / 1e8).toFixed(2)}亿`
    if (abs >= 1e4) return `${(volume / 1e4).toFixed(2)}万`
    return `${volume}`
  }

  const formatBarTime = (timestamp: number): string => {
    const date = new Date(timestamp)
    const pad = (n: number) => `${n}`.padStart(2, '0')
    const ymd = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
    // 分时及分钟/小时级周期显示到时分，日及以上只显示日期
    const period = chart.getPeriod()
    const isIntraday = timeShareState.active ||
      (period != null && !['day', 'week', 'month', 'year'].includes(period.type))
    return isIntraday ? `${ymd} ${pad(date.getHours())}:${pad(date.getMinutes())}` : ymd
  }

  interface InfoCell {
    label: string
    value: string
    color?: string
    cellClass?: string
  }

  // 统一渲染：PC 端 8 列 2 行 / 移动端 4 列 4 行
  // 行1：时间 今价 今开 最高 最低 均价 涨跌 振幅
  // 行2：换手率 成交量 总市值 流通市值 市盈 市盈动 市盈静 市净率
  const renderInfoTable = (hovered: KLineData | null) => {
    const dataList = chart.getDataList()
    if (dataList.length === 0) {
      infoTable.innerHTML = ''
      return
    }
    const found = hovered != null ? dataList.indexOf(hovered) : -1
    const i = found >= 0 ? found : dataList.length - 1
    const current = dataList[i]
    // 与图上一致：按昨收判定红涨绿跌
    const prevClose = i > 0 ? dataList[i - 1].close : current.open
    const change = current.close - prevClose
    const pct = prevClose !== 0 ? (change / prevClose) * 100 : 0
    const color = change > 0 ? CN_UP_COLOR : change < 0 ? CN_DOWN_COLOR : CN_FLAT_COLOR
    const sign = change > 0 ? '+' : ''
    const fixed = (v: number) => v.toFixed(2)
    const neutral = 'var(--tb-text)'
    const ohlc: Record<string, InfoCell> = {
      time: { label: t('时间|Time'), value: formatBarTime(current.timestamp), color: neutral, cellClass: 'cell-time' },
      open: { label: t('今开|Open'), value: fixed(current.open) },
      close: { label: t('今价|Close'), value: fixed(current.close) },
      high: { label: t('最高|High'), value: fixed(current.high) },
      low: { label: t('最低|Low'), value: fixed(current.low) },
      chg: { label: t('涨跌|Chg'), value: `${sign}${fixed(change)} (${sign}${fixed(pct)}%)` },
      vol: { label: t('成交量|Vol'), value: formatVolumeText(current.volume ?? 0) }
    }
    const fund = buildFundamentalItems(latestFundamental, locale, hovered, dataList)
    // 行1 的 均价/涨跌/振幅/开/收/高/低 随红涨绿跌着色（时间除外）；行2 与当日涨跌无关，统一中性色
    const neutralCell = (cell: { label: string; value: string }): InfoCell => ({ ...cell, color: neutral })
    const cells: InfoCell[] = [
      ohlc.time, ohlc.close, ohlc.open, ohlc.high, ohlc.low, fund.avgPrice, ohlc.chg, fund.amplitude,
      neutralCell(fund.turnover), neutralCell(ohlc.vol), neutralCell(fund.totalMarketCap), neutralCell(fund.floatMarketCap),
      neutralCell(fund.pe), neutralCell(fund.peDynamic), neutralCell(fund.peStatic), neutralCell(fund.pb)
    ]
    infoTable.innerHTML = cells.map(cell =>
      `<div class="info-cell ${cell.cellClass ?? ''}"><span class="info-label">${cell.label}</span>` +
      `<span class="info-value" style="color: ${cell.color ?? color}">${cell.value}</span></div>`
    ).join('')
  }

  infoTableRender = renderInfoTable
  renderInfoTable(null)

  // ---------------- 鼠标 K 线选择（右键切换） ----------------

  // 开启：klinecharts 默认效果，十字光标 + tooltip 跟随鼠标
  // 关闭：无十字光标，tooltip 固定显示最后一根
  let mouseSelectEnabled = true

  const setMouseSelect = (enabled: boolean) => {
    mouseSelectEnabled = enabled
    chart.setStyles({ crosshair: { show: enabled } })
    // 信息表格与 tooltip 行为保持一致：开启跟鼠标，关闭固定最后一根
    hoverBar = null
    renderInfoTable(null)
    if (enabled) {
      // 清除关闭期间钉住的带 paneId 的 crosshair，否则十字线残留在最后一根
      chart.executeAction('onCrosshairChange', null as never)
    } else {
      // 无 x 的 crosshair 会被库归一化指向最后一根，tooltip 随之固定
      chart.executeAction('onCrosshairChange', {})
    }
  }

  // 关闭状态下鼠标移动仍会写入带 x 的 crosshair 使 tooltip 跟随，监听变化重新钉回最后一根
  chart.subscribeAction('onCrosshairChange', data => {
    if (!mouseSelectEnabled && typeof (data as { x?: number })?.x === 'number') {
      chart.executeAction('onCrosshairChange', {})
    }
  })

  // 十字光标悬停时信息栏跟随对应 K 线。
  // 注意：库派发的回调参数是原始 {x, y, paneId}，不含 K 线数据，
  // 需用 x 通过 convertFromPixel 反查 dataIndex 再取 K 线。
  let hoverBar: KLineData | null = null
  chart.subscribeAction('onCrosshairChange', data => {
    const x = (data as { x?: number }).x
    // 关闭鼠标选择时 tooltip 钉在最后一根，信息表格保持一致
    if (!mouseSelectEnabled || typeof x !== 'number') {
      hoverBar = null
      renderInfoTable(null)
      return
    }
    const points = chart.convertFromPixel([{ x }]) as Array<{ dataIndex?: number }>
    const dataList = chart.getDataList()
    const index = points[0]?.dataIndex ?? -1
    hoverBar = index >= 0 && index < dataList.length ? dataList[index] : null
    renderInfoTable(hoverBar)
  })
  // 数据加载/轮询刷新/周期切换后，若未在悬停则刷新为最新一根
  chart.subscribeAction('onVisibleRangeChange', () => {
    if (hoverBar == null) {
      renderInfoTable(null)
    }
  })
  // 鼠标移出画布时库不派发 onCrosshairChange，需自行恢复显示最后一根
  root.querySelector('#container')?.addEventListener('mouseleave', () => {
    hoverBar = null
    renderInfoTable(null)
  })

  root.querySelector('#container')!.addEventListener('contextmenu', event => {
    event.preventDefault()
    setMouseSelect(!mouseSelectEnabled)
  })

  // ---------------- 分时切换 ----------------

  const identityAxisRange: AxisCreateRangeCallback = ({ defaultRange }) => defaultRange
  const timeShareAxisRange: AxisCreateRangeCallback = ({ defaultRange }) =>
    symmetricRangeAround(timeShareState.prevClose, defaultRange)
  let percentAxisId: string | null = null

  // 分时上下留白对称，保证昨收基准线严格居中（默认 gap 上 0.2 / 下 0.1 不对称）
  const TIME_SHARE_AXIS_GAP = { top: 0.08, bottom: 0.08 }
  const DEFAULT_AXIS_GAP = { top: 0.2, bottom: 0.1 }

  const applyTimeShareStyles = () => {
    // 主图切为面积走势线，隐藏高低点标记
    chart.setStyles({
      candle: {
        type: 'area',
        priceMark: { high: { show: false }, low: { show: false } }
      }
    })
  }

  const restoreCandleStyles = () => {
    chart.setStyles({
      candle: {
        type: 'candle_solid',
        priceMark: { high: { show: true }, low: { show: true } }
      }
    })
  }

  // 分时全天一屏：按全天 242 分钟定 bar 宽，未交易时段在右侧留白，
  // 已交易 bar 从左侧 09:30 起铺开，锚点位置全天恒定
  const calibrateTimeShareFit = (dataCount: number) => {
    // 逐轮校准：设置 barSpace 后 y 轴宽度可能随刻度文本变化，内容宽随之
    // 改变，需要用稳定后的画布宽重新计算，直到收敛，保证 242 根恰好铺满
    // 内容区，首尾无空隙也无滚动裁切
    let prevWidth = -1
    for (let i = 0; i < 3; i++) {
      chart.resize()
      const canvas = chart.getDom('candle_pane', 'main')?.querySelector('canvas')
      const width = canvas?.getBoundingClientRect().width ?? 0
      if (width <= 0 || width === prevWidth) {
        break
      }
      prevWidth = width
      const space = width / TIME_SHARE_TOTAL_BARS
      if (space < 1) {
        // 低于 barSpaceLimit 下限，保持默认由用户滚动查看
        break
      }
      chart.setBarSpace(space)
      chart.setOffsetRightDistance(Math.max(0, Math.round((TIME_SHARE_TOTAL_BARS - dataCount) * space)))
    }
    // setOffsetRightDistance 不触发布局，补一次全量布局生效
    chart.resize()
  }

  // 轮询首次更新后的复校标记：init 布局已校准显示，若更新重建刻度导致
  // 左轴宽度变化再收敛一次（宽度未变时校准内 setBarSpace 同值直返，无重绘）
  let pendingTimeShareFit = 0

  const fitTimeShareBars = (dataCount: number) => {
    if (dataCount <= 0) {
      return
    }
    pendingTimeShareFit = dataCount
    // 兜底：轮询始终无更新时也能完成一次复校
    window.setTimeout(() => {
      if (pendingTimeShareFit > 0) {
        const count = pendingTimeShareFit
        pendingTimeShareFit = 0
        calibrateTimeShareFit(count)
      }
    }, 1500)
  }

  // 分时 x 轴：A 股交易时段锚点（默认 tick 估算按日期文本宽度，标签会落在 10:46 之类的任意分钟）
  const coordinateOfTimestamp = (timestamp: number): number | null => {
    const point = chart.convertToPixel({ timestamp })
    const x = Array.isArray(point) ? point[0]?.x : point?.x
    return typeof x === 'number' ? x : null
  }

  const timeShareXTicks: AxisCreateTicksCallback = ({ range, bounding, defaultTicks }) => {
    const dataList = chart.getDataList()
    const dayKey = timeShareState.dayKey
    if (dataList.length === 0 || dayKey == null) {
      return defaultTicks
    }
    // 窄屏只保留首、午休、尾三个锚点
    const anchors = bounding.width < 360
      ? TIME_SHARE_X_ANCHORS.filter(a => a.hhmm === '0930' || a.mergeNoon === true || a.hhmm === '1500')
      : TIME_SHARE_X_ANCHORS
    const ticks: AxisTick[] = []
    for (const anchor of anchors) {
      const timestamp = parseCnBarTime(`${dayKey}${anchor.hhmm}`)
      if (!Number.isFinite(timestamp)) {
        continue
      }
      const index = dataList.findIndex(bar => bar.timestamp === timestamp)
      if (index < 0 || index < range.realFrom - 1 || index > range.realTo) {
        continue
      }
      let coord = coordinateOfTimestamp(timestamp)
      if (coord == null) {
        continue
      }
      if (anchor.mergeNoon === true) {
        // 午休中点（11:30 与 13:00 之间）
        const noonTimestamp = parseCnBarTime(`${dayKey}1300`)
        const noonCoord = Number.isFinite(noonTimestamp) ? coordinateOfTimestamp(noonTimestamp) : null
        if (noonCoord != null) {
          coord = (coord + noonCoord) / 2
        }
      }
      // 首尾标签向内收缩约半字宽，避免被画布边缘裁剪
      coord = Math.min(Math.max(coord, 17), bounding.width - 17)
      ticks.push({ coord, value: timestamp, text: anchor.text })
    }
    return ticks
  }

  const defaultXTicks: AxisCreateTicksCallback = ({ defaultTicks }) => defaultTicks

  // 分时形态整体切换：在 init 数据就绪后与数据注入同帧执行，
  // 旧图（原周期 K 线）保持显示直至此刻被一次重绘替换，无白屏也无中间形态
  const applyTimeShareTransforms = () => {
    mainIndicatorState.forEach(name => { chart.removeIndicator({ name, paneId: 'candle_pane' }) })
    chart.createIndicator({ name: 'TIME', paneId: 'candle_pane' }, true)
    // 跨交易日重载时形态已就位，避免重复创建百分比轴
    if (percentAxisId == null) {
      percentAxisId = chart.createYAxis({ paneId: 'candle_pane', position: 'left', name: PERCENT_Y_AXIS_NAME })
    }
    chart.overrideYAxis({ paneId: 'candle_pane', createRange: timeShareAxisRange, gap: TIME_SHARE_AXIS_GAP })
    chart.overrideXAxis({ createTicks: timeShareXTicks })
    applyTimeShareStyles()
  }

  const activateTimeShare = () => {
    timeShareState.active = true
    // 仅切换周期触发数据加载；指标/坐标轴/样式等形态变更延迟到数据就绪后
    // 与注入同帧应用，加载期间旧图原样保留（与普通周期切换行为一致）
    chart.setPeriod({ span: 1, type: 'minute' })
  }

  const deactivateTimeShare = (nextPeriod: Period | null) => {
    timeShareState.active = false
    timeShareState.dayKey = null
    timeShareState.prevClose = Number.NaN
    timeShareState.lotSize = 100
    timeShareState.isIndex = false
    pendingTimeShareFit = 0
    chart.removeIndicator({ name: 'TIME', paneId: 'candle_pane' })
    if (percentAxisId != null) {
      chart.removeYAxis({ id: percentAxisId })
      percentAxisId = null
    }
    chart.overrideYAxis({ paneId: 'candle_pane', createRange: identityAxisRange, gap: DEFAULT_AXIS_GAP })
    chart.overrideXAxis({ createTicks: defaultXTicks })
    restoreCandleStyles()
    mainIndicatorState.forEach(name => { chart.createIndicator({ name, paneId: 'candle_pane' }, true) })
    if (nextPeriod != null) {
      chart.setPeriod(nextPeriod)
    }
  }

  // ---------------- 工具栏逻辑 ----------------

  const closeDropdowns = (exclude?: Element) => {
    root.querySelectorAll('.dropdown.open').forEach(el => {
      if (el !== exclude) {
        el.classList.remove('open')
      }
    })
  }

  const bindDropdown = (btnId: string, dropdownId: string) => {
    const btn = root.querySelector<HTMLButtonElement>(`#${btnId}`)!
    const dropdown = root.querySelector(`#${dropdownId}`)!
    btn.addEventListener('click', () => {
      const willOpen = !dropdown.classList.contains('open')
      closeDropdowns()
      if (willOpen) {
        dropdown.classList.add('open')
      }
    })
  }

  document.addEventListener('click', event => {
    const target = event.target as Element
    if (!target.closest('.toolbar-item')) {
      closeDropdowns()
    }
  })

  bindDropdown('symbol-btn', 'symbol-dropdown')
  bindDropdown('main-indicator-btn', 'main-indicator-dropdown')
  bindDropdown('sub-indicator-btn', 'sub-indicator-dropdown')
  bindDropdown('drawing-btn', 'drawing-dropdown')

  // 标的搜索
  const symbolBtn = root.querySelector<HTMLButtonElement>('#symbol-btn')!
  const symbolList = root.querySelector<HTMLDivElement>('#symbol-list')!
  const searchInput = root.querySelector<HTMLInputElement>('#symbol-search-input')!
  const clearBtn = root.querySelector<HTMLButtonElement>('#search-clear-btn')!

  // 更新清空按钮显示状态
  const updateClearBtnVisibility = () => {
    if (searchInput.value.trim() !== '') {
      clearBtn.classList.add('visible')
    } else {
      clearBtn.classList.remove('visible')
    }
  }

  let searchTimer: ReturnType<typeof setTimeout> | undefined
  const renderSymbolList = (items: SymbolSearchItem[]) => {
    symbolList.innerHTML = ''
    if (items.length === 0) {
      const empty = document.createElement('div')
      empty.className = 'symbol-empty'
      empty.textContent = t('无结果|No results')
      symbolList.appendChild(empty)
      return
    }
    // 股票名来自外部接口，用 textContent 写入避免 HTML 注入
    for (const item of items) {
      const row = document.createElement('div')
      row.className = 'symbol-row'
      row.setAttribute('role', 'button')
      row.dataset.ticker = item.ticker
      row.dataset.market = item.market
      const ticker = document.createElement('span')
      ticker.className = 'symbol-ticker'
      ticker.textContent = item.ticker
      const name = document.createElement('span')
      name.className = 'symbol-name'
      name.textContent = item.name
      row.append(ticker, name)
      symbolList.appendChild(row)
    }
  }
  const doSearch = async (query: string) => {
    const q = query.trim()
    if (q === '') {
      renderSymbolList(DEFAULT_SYMBOLS)
      return
    }
    try {
      renderSymbolList(await searchCnSymbols(q))
    } catch {
      renderSymbolList([])
    }
  }
  searchInput.addEventListener('input', () => {
    // 更新清空按钮显示状态
    updateClearBtnVisibility()

    if (searchTimer != null) {
      clearTimeout(searchTimer)
    }
    searchTimer = setTimeout(() => { doSearch(searchInput.value) }, 300)
  })

  // 清空按钮点击事件
  clearBtn.addEventListener('click', (e) => {
    e.stopPropagation() // 阻止事件冒泡，避免关闭下拉框
    searchInput.value = ''
    updateClearBtnVisibility()
    renderSymbolList(DEFAULT_SYMBOLS)
    searchInput.focus()
  })

  symbolBtn.addEventListener('click', () => {
    if (searchInput.value.trim() === '' && symbolList.children.length === 0) {
      renderSymbolList(DEFAULT_SYMBOLS)
    }
    // 打开时更新清空按钮状态
    updateClearBtnVisibility()
  })
  symbolList.addEventListener('click', event => {
    const row = (event.target as Element).closest<HTMLElement>('.symbol-row')
    if (!row) {
      return
    }
    const ticker = row.dataset.ticker!
    const market = row.dataset.market ?? 'sh'
    const newSymbol = { ticker, pricePrecision: 2, volumePrecision: 0, market }
    symbolBtn.textContent = row.querySelector('.symbol-name')?.textContent ?? ticker
    chart.setSymbol(newSymbol)
    // 切换标的时强制刷新基本面数据（清除缓存重新获取，完成后整体刷新信息表格）
    void updateFundamentalBar(newSymbol, true)
    closeDropdowns()
  })

  // 周期切换：主栏仅保留 日/周/月，分时与分钟、时线周期收进「周期」菜单
  const periodGroup = root.querySelector<HTMLDivElement>('#period-group')!
  const MAIN_PERIOD_OPTIONS = PERIOD_OPTIONS.filter(o => ['1d', '1w', '1M'].includes(o.key))
  const MENU_PERIOD_OPTIONS = PERIOD_OPTIONS.filter(o => !MAIN_PERIOD_OPTIONS.includes(o))
  const DEFAULT_PERIOD_KEY = '1d'
  periodGroup.innerHTML =
    MAIN_PERIOD_OPTIONS.map(option =>
      `<button class="tb-btn period-btn" data-key="${option.key}">${t(option.text)}</button>`
    ).join('') +
    `<div class="toolbar-item">
      <button class="tb-btn tb-dd" id="period-more-btn">${t('周期|Period')}</button>
      <div class="dropdown indicator-dropdown" id="period-dropdown">` +
    `<button class="tb-btn tool-btn period-btn" data-key="time">${t('分时|Time')}</button>` +
    MENU_PERIOD_OPTIONS.map(option =>
      `<button class="tb-btn tool-btn period-btn" data-key="${option.key}">${t(option.text)}</button>`
    ).join('') +
    `</div>
    </div>`

  const periodMoreBtn = root.querySelector<HTMLButtonElement>('#period-more-btn')!
  bindDropdown('period-more-btn', 'period-dropdown')

  // 菜单内周期选中时，「周期」按钮改为显示该周期并高亮
  const applyPeriodActive = (key: string) => {
    periodGroup.querySelectorAll<HTMLButtonElement>('.period-btn').forEach(el => {
      el.classList.toggle('active', el.dataset.key === key)
    })
    const menuOption = MENU_PERIOD_OPTIONS.find(o => o.key === key)
    const menuText = key === 'time' ? t('分时|Time') : menuOption != null ? t(menuOption.text) : null
    periodMoreBtn.classList.toggle('active', menuText != null)
    periodMoreBtn.textContent = menuText ?? t('周期|Period')
  }
  applyPeriodActive(DEFAULT_PERIOD_KEY)

  periodGroup.addEventListener('click', event => {
    const btn = (event.target as Element).closest<HTMLButtonElement>('.period-btn')
    if (!btn || btn.classList.contains('active')) {
      return
    }
    applyPeriodActive(btn.dataset.key!)
    if (btn.dataset.key === 'time') {
      activateTimeShare()
      closeDropdowns()
      return
    }
    const option = PERIOD_OPTIONS.find(o => o.key === btn.dataset.key)!
    if (timeShareState.active) {
      deactivateTimeShare({ span: option.span, type: option.type })
    } else {
      chart.setPeriod({ span: option.span, type: option.type })
    }
    closeDropdowns()
  })

  // 指标开关
  const bindIndicatorDropdown = (dropdownId: string, names: string[], state: Set<string>, isMain: boolean) => {
    const dropdown = root.querySelector<HTMLDivElement>(`#${dropdownId}`)!
    dropdown.innerHTML = names.map(name =>
      `<label class="check-row"><input type="checkbox" value="${name}"${state.has(name) ? ' checked' : ''}/>${name}</label>`
    ).join('')
    dropdown.addEventListener('change', event => {
      const input = event.target as HTMLInputElement
      const name = input.value
      if (input.checked) {
        if (isMain) {
          chart.createIndicator({ name, paneId: 'candle_pane' }, true)
        } else {
          chart.createIndicator({ name })
        }
        state.add(name)
      } else {
        chart.removeIndicator({ name })
        state.delete(name)
      }
    })
  }
  bindIndicatorDropdown('main-indicator-dropdown', MAIN_INDICATORS, mainIndicatorState, true)
  bindIndicatorDropdown('sub-indicator-dropdown', SUB_INDICATORS, subIndicatorState, false)

  // 绘图工具
  let activeTool: string | null = null
  let drawingOverlayId: string | null = null
  const drawingDropdown = root.querySelector<HTMLDivElement>('#drawing-dropdown')!
  drawingDropdown.innerHTML = DRAWING_TOOLS.map(tool =>
    `<button class="tb-btn tool-btn" data-name="${tool.name}">${t(tool.text)}</button>`
  ).join('')
  const clearActiveTool = () => {
    activeTool = null
    drawingOverlayId = null
    drawingDropdown.querySelectorAll('.tool-btn').forEach(el => { el.classList.remove('active') })
  }
  drawingDropdown.addEventListener('click', event => {
    const btn = (event.target as Element).closest<HTMLButtonElement>('.tool-btn')
    if (!btn) {
      return
    }
    const name = btn.dataset.name!
    if (activeTool === name) {
      if (drawingOverlayId != null) {
        chart.removeOverlay({ id: drawingOverlayId })
      }
      clearActiveTool()
      return
    }
    clearActiveTool()
    activeTool = name
    btn.classList.add('active')
    const id = chart.createOverlay({
      name,
      onDrawEnd: () => { clearActiveTool() }
    })
    drawingOverlayId = typeof id === 'string' ? id : null
  })
  root.querySelector<HTMLButtonElement>('#clear-btn')!.addEventListener('click', () => {
    chart.removeOverlay()
    clearActiveTool()
  })

  // 指标参数设置弹窗
  const indicatorModal = root.querySelector<HTMLDivElement>('#indicator-modal')!
  const indicatorSelect = root.querySelector<HTMLSelectElement>('#indicator-select')!
  const paramList = root.querySelector<HTMLDivElement>('#param-list')!
  const modalIndicator = root.querySelector<HTMLButtonElement>('#indicator-setting-btn')!
  let modalIndicators: Array<{ name: string; paneId: string; calcParams: number[] }> = []

  const closeModal = () => {
    indicatorModal.classList.remove('open')
  }

  const renderParamList = (calcParams: number[], name: string) => {
    const meta = INDICATOR_PARAM_META[name]
    if (calcParams.length === 0) {
      paramList.innerHTML = `<div class="symbol-empty">${t('该指标无可设置参数|No parameters')}</div>`
      return
    }
    paramList.innerHTML = calcParams.map((value, index) => {
      const m = meta?.[index]
      const label = m ? t(m.label) : `${t('参数|Param')} ${index + 1}`
      const min = m?.min ?? 1
      const step = m?.decimal === true ? 0.01 : 1
      return `
        <div class="param-row">
          <span class="param-label">${label}</span>
          <input class="param-input" type="number" value="${value}" min="${min}" step="${step}"/>
        </div>`
    }).join('')
  }

  const selectModalIndicator = (index: number) => {
    const indicator = modalIndicators[index]
    if (!indicator) {
      paramList.innerHTML = ''
      return
    }
    renderParamList(indicator.calcParams, indicator.name)
  }

  const openModal = () => {
    modalIndicators = chart.getIndicators().map(indicator => ({
      name: indicator.name,
      paneId: indicator.paneId,
      calcParams: (indicator.calcParams ?? []).map(p => Number(p))
    }))
    indicatorSelect.innerHTML = modalIndicators.map((indicator, index) =>
      `<option value="${index}">${indicator.name}${indicator.paneId === 'candle_pane' ? t('（主图）| (Main)') : t('（副图）| (Sub)')}</option>`
    ).join('')
    if (modalIndicators.length === 0) {
      indicatorSelect.innerHTML = `<option value="-1">${t('暂无指标|No indicators')}</option>`
    }
    indicatorSelect.value = '0'
    selectModalIndicator(modalIndicators.length > 0 ? 0 : -1)
    indicatorModal.classList.add('open')
  }

  modalIndicator.addEventListener('click', () => {
    closeDropdowns()
    openModal()
  })
  indicatorSelect.addEventListener('change', () => {
    selectModalIndicator(Number(indicatorSelect.value))
  })
  root.querySelector('#indicator-modal-close')!.addEventListener('click', closeModal)
  root.querySelector('#indicator-modal-cancel')!.addEventListener('click', closeModal)
  indicatorModal.addEventListener('click', event => {
    if (event.target === indicatorModal) {
      closeModal()
    }
  })
  root.querySelector('#indicator-modal-confirm')!.addEventListener('click', () => {
    const indicator = modalIndicators[Number(indicatorSelect.value)]
    if (indicator) {
      const inputs = Array.from(paramList.querySelectorAll<HTMLInputElement>('.param-input'))
      const calcParams = inputs.map(input => {
        const value = parseFloat(input.value)
        const min = parseFloat(input.min || '0')
        const clamped = Number.isNaN(value) ? min : Math.max(value, min)
        // step 为 1 的整数参数取整（BOLL 标准差、SAR 等小数参数 step 为 0.01，保留小数）
        return input.step === '1' ? Math.round(clamped) : clamped
      })
      chart.overrideIndicator({ paneId: indicator.paneId, name: indicator.name, calcParams })
    }
    closeModal()
  })
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      closeModal()
      closeDropdowns()
    }
  })

  // 主题
  const themeBtn = root.querySelector<HTMLButtonElement>('#theme-btn')!
  themeBtn.addEventListener('click', () => {
    // dark 类挂在应用根节点上，与 #app 命名空间的 CSS 配套，不污染宿主页面
    const isDark = root.classList.toggle('dark')
    chart.setStyles(isDark ? 'dark' : 'light')
    // 主题切换会整体替换样式，A 股配色与分时面积图样式需重新应用
    applyCnColorScheme()
    if (timeShareState.active) {
      applyTimeShareStyles()
    }
    // 十字光标显隐同理，随主题样式整体替换后恢复
    setMouseSelect(mouseSelectEnabled)
    // 开关滑块状态由根节点 dark 类经 CSS 驱动，无需改文字
  })
}
