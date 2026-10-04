import type { BoardRankItem } from '../../../chart/types'
import type { TTLCache } from '../../cache'
import type { BoardKind, BoardSortKey } from '../types'
import { fetchJson, UpstreamError } from './http'
import { parseBoardRankList } from './parse'

/** 腾讯官方板块排名服务（zxg_ranking_cgi）：仅支持板块维度（行业/概念/地域），无个股全市场榜单 */
const RANK_URL = 'https://proxy.finance.qq.com/cgi/cgi-bin/rank/pt/getRank'

/** 领域板块维度 → 上游 board_code（board_type 同值） */
const BOARD_PARAM: Record<BoardKind, string> = {
  industry: 'hy',
  concept: 'gn'
}

/** 领域排序键 → 上游 sort_type 枚举（换手率上游不支持排序，未登记） */
const SORT_PARAM: Record<BoardSortKey, string> = {
  changePct: 'PriceRatio',
  turnover: 'Turnover'
}

/** 上游 direct 语义：down=降序（涨幅榜在前），up=升序（跌幅榜在前） */
const DIRECT_PARAM = { desc: 'down', asc: 'up' } as const

export const fetchBoardRanking = async (
  cache: TTLCache<BoardRankItem[]>,
  board: BoardKind,
  sort: BoardSortKey,
  direction: 'asc' | 'desc',
  limit: number
): Promise<BoardRankItem[]> =>
  cache.getOrLoad(`tencent:rank:${board}:${sort}:${direction}:${limit}`, async () => {
    const query = new URLSearchParams({
      board_code: BOARD_PARAM[board],
      board_type: BOARD_PARAM[board],
      sort_type: SORT_PARAM[sort],
      direct: DIRECT_PARAM[direction],
      offset: '0',
      count: String(limit)
    })
    const payload = await fetchJson<unknown>(`${RANK_URL}?${query.toString()}`)
    const items = parseBoardRankList(payload)
    if (items.length === 0) {
      throw new UpstreamError(`board ranking is empty for ${board}/${sort}/${direction}`, RANK_URL)
    }
    return items
  })
