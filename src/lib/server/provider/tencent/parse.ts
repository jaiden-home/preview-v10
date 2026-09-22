import type { KLineData } from 'klinecharts'
import { parseCnBarTime } from '../../../chart/utils'
import type { FundamentalData, SymbolSearchItem } from '../../../chart/types'

// ==================== 腾讯协议解析（仅供 tencent provider 内部使用） ====================

/**
 * 解析腾讯实时行情（qt.gtimg.cn）GBK 解码后的文本。
 * 格式：v_sh600519="1~贵州茅台~600519~..."，字段以 ~ 分隔。
 * 返回名称、现价、昨收与基本面指标；解析失败返回 null。
 */
export const parseQtQuote = (
  text: string,
  code: string
): {
  name: string | null
  price: number | null
  prevClose: number | null
  invalid: boolean
  fundamental: FundamentalData
} => {
  const match = text.match(new RegExp(`${code}="([^"]+)`))
  if (!match) {
    return { name: null, price: null, prevClose: null, invalid: true, fundamental: {} }
  }
  const fields = match[1].split('~')

  // 腾讯 A 股行情字段表（已用新浪实测数据核对，sh600519）：
  // [1]  名称              [3]  现价        [4]  昨收
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
  const parsePrice = (val: string | undefined): number | null => {
    if (val == null || val === '') return null
    const num = Number(val)
    return Number.isFinite(num) && num > 0 ? num : null
  }

  const name = fields.length > 1 && fields[1] !== '' && fields[1] !== '-' ? fields[1] : null
  const totalCapYi = parseNum(fields[45])
  const floatCapYi = parseNum(fields[44])

  return {
    name,
    price: parsePrice(fields[3]),
    prevClose: parsePrice(fields[4]),
    invalid: name == null,
    fundamental: {
      turnoverRate: parseNum(fields[38]),
      amplitude: parseNum(fields[43]),
      pe: parseNum(fields[39]),
      peDynamic: parseNum(fields[52]),
      peStatic: parseNum(fields[53]),
      pb: parseNum(fields[46]),
      totalMarketCap: totalCapYi != null ? totalCapYi * 1e8 : undefined,
      floatMarketCap: floatCapYi != null ? floatCapYi * 1e8 : undefined,
      avgPrice: parseNum(fields[51])
    }
  }
}

/** 腾讯 K 线行解析：时间, 开, 收, 高, 低, 量 */
export const parseTencentKlines = (rows: unknown[]): KLineData[] =>
  rows
    .map((row): KLineData | null => {
      if (!Array.isArray(row) || row.length < 6) {
        return null
      }
      const timestamp = parseCnBarTime(String(row[0]))
      if (Number.isNaN(timestamp)) {
        return null
      }
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

/** 时间戳 → 腾讯接口日期参数（YYYY-MM-DD，本地时区） */
export const formatTencentDate = (timestamp: number): string => {
  const date = new Date(timestamp)
  const month = `${date.getMonth() + 1}`.padStart(2, '0')
  const day = `${date.getDate()}`.padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

/** 腾讯上游周期键映射（PERIOD_OPTIONS 周期键 → 接口 param 周期） */
export const CN_TENCENT_PERIOD: Record<string, string> = {
  '1m': 'm1',
  '5m': 'm5',
  '15m': 'm15',
  '30m': 'm30',
  '1h': 'm60',
  '1d': 'day',
  '1w': 'week',
  '1M': 'month'
}

const isTradingMinute = (hhmm: string): boolean =>
  (hhmm >= '0930' && hhmm <= '1130') || (hhmm >= '1300' && hhmm <= '1500')

/**
 * 官方分时点 "0930 1277.27 133 16987691.06" = 时间 价格 累计量 累计额(元)
 * 主板/创业板/北交 quantity 单位为手，科创板为股（北交所无累计额列）
 * 差分出每分钟量（统一转手）/额；open 取前一分钟价格（首根用 basePrice），供成交量按分钟涨跌着色
 */
export const parseTimeShareDay = (
  date: string,
  points: unknown[],
  basePrice: number,
  sharesPerLot = 1
): KLineData[] => {
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
    const volume = Number.isFinite(cumVolume) ? Math.max(0, Math.round((cumVolume - prevCumVolume) / sharesPerLot)) : 0
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

const SMARTBOX_MARKETS = new Set(['sh', 'sz', 'bj'])

/**
 * smartbox 联想接口解析（服务端无 CORS 限制，解锁按名称搜索）。
 * 返回形如 v_hint=["sh600519~贵州茅台~gp~sh",...] 的 GBK 文本，格式随版本略有差异，做防御性解析。
 */
export const parseSmartboxResponse = (text: string, limit = 10): SymbolSearchItem[] => {
  const arrayMatch = text.match(/\[[\s\S]*\]/)
  if (arrayMatch == null) {
    return []
  }
  let entries: unknown[]
  try {
    entries = JSON.parse(arrayMatch[0].replace(/'/g, '"')) as unknown[]
  } catch {
    return []
  }
  const items: SymbolSearchItem[] = []
  for (const entry of entries) {
    if (typeof entry !== 'string' || items.length >= limit) {
      continue
    }
    const parts = entry.split('~')
    const codeToken = parts.find((part) => /^(sh|sz|bj)\d{6}$/.test(part))
    if (codeToken == null) {
      continue
    }
    const market = codeToken.slice(0, 2)
    if (!SMARTBOX_MARKETS.has(market)) {
      continue
    }
    const ticker = codeToken.slice(2)
    // 名称：优先取独立 6 位代码段之外的中文段，回退首段
    const name =
      parts.find(
        (part) => part !== codeToken && /[\u4e00-\u9fa5A-Za-z]/.test(part) && !/^(gp|zs|fund|hk|us)$/i.test(part)
      ) ?? parts[0]
    items.push({ ticker, name: String(name), market })
  }
  return items
}
