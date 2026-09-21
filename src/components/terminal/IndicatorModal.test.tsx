import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import IndicatorModal, { type ModalIndicator } from './IndicatorModal'
import { createT } from '@/lib/i18n'

const defaultIndicators = (): ModalIndicator[] => [
  { name: 'MA', paneId: 'candle_pane', calcParams: [5, 10, 30, 60] },
  { name: 'VOL', paneId: 'indicator_pane_1', calcParams: [5, 10] },
  { name: 'MACD', paneId: 'indicator_pane_2', calcParams: [12, 26, 9] }
]

const getSelect = () => document.querySelector<HTMLSelectElement>('#indicator-select')!

const getParamLabels = () =>
  Array.from(document.querySelectorAll<HTMLElement>('#param-list .param-label')).map((el) => el.textContent)

const getParamInputs = () => Array.from(document.querySelectorAll<HTMLInputElement>('#param-list .param-input'))

const submitForm = () => {
  const form = document.querySelector<HTMLFormElement>('.modal form')!
  fireEvent.submit(form)
}

describe('指标参数设置弹窗', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
    window.location.hash = ''
    vi.clearAllMocks()
  })

  it('打开时指标列表来自快照并标注主/副图', () => {
    render(
      <IndicatorModal indicators={defaultIndicators()} t={createT('zh-CN')} onClose={vi.fn()} onConfirm={vi.fn()} />
    )
    const options = Array.from(getSelect().options).map((o) => o.textContent)
    expect(options).toEqual(['MA（主图）', 'VOL（副图）', 'MACD（副图）'])
    expect(getSelect().value).toBe('0')
  })

  it('默认渲染第一个指标的参数，使用元数据标签和实时值', () => {
    render(
      <IndicatorModal indicators={defaultIndicators()} t={createT('zh-CN')} onClose={vi.fn()} onConfirm={vi.fn()} />
    )
    expect(getParamLabels()).toEqual(['MA1', 'MA2', 'MA3', 'MA4'])
    expect(getParamInputs().map((i) => i.value)).toEqual(['5', '10', '30', '60'])
    expect(getParamInputs()[0].min).toBe('1')
    expect(getParamInputs()[0].step).toBe('1')
  })

  it('切换下拉选项后重新渲染对应指标参数', () => {
    render(
      <IndicatorModal indicators={defaultIndicators()} t={createT('zh-CN')} onClose={vi.fn()} onConfirm={vi.fn()} />
    )
    fireEvent.change(getSelect(), { target: { value: '2' } })
    expect(getParamLabels()).toEqual(['快线', '慢线', '信号'])
    expect(getParamInputs().map((i) => i.value)).toEqual(['12', '26', '9'])
  })

  it('BOLL 的标准差参数支持小数（step 0.01）', () => {
    render(
      <IndicatorModal
        indicators={[{ name: 'BOLL', paneId: 'candle_pane', calcParams: [20, 2] }]}
        t={createT('zh-CN')}
        onClose={vi.fn()}
        onConfirm={vi.fn()}
      />
    )
    const inputs = getParamInputs()
    expect(getParamLabels()).toEqual(['周期', '标准差'])
    expect(inputs[1].step).toBe('0.01')
    expect(inputs[1].min).toBe('0.1')
  })

  it('calcParams 为空的指标显示无可设置参数', () => {
    render(
      <IndicatorModal
        indicators={[{ name: 'PVT', paneId: 'indicator_pane_1', calcParams: [] }]}
        t={createT('zh-CN')}
        onClose={vi.fn()}
        onConfirm={vi.fn()}
      />
    )
    expect(screen.getByText('该指标无可设置参数')).toBeTruthy()
  })

  it('当前无指标时显示「暂无指标」，提交不调用 onConfirm', () => {
    const onConfirm = vi.fn()
    render(<IndicatorModal indicators={[]} t={createT('zh-CN')} onClose={vi.fn()} onConfirm={onConfirm} />)
    expect(getSelect().textContent).toContain('暂无指标')
    submitForm()
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('修改参数并确认后调用 onConfirm', () => {
    const onConfirm = vi.fn()
    render(
      <IndicatorModal indicators={defaultIndicators()} t={createT('zh-CN')} onClose={vi.fn()} onConfirm={onConfirm} />
    )
    fireEvent.change(getParamInputs()[0], { target: { value: '20' } })
    submitForm()
    expect(onConfirm).toHaveBeenCalledTimes(1)
    expect(onConfirm).toHaveBeenCalledWith('candle_pane', 'MA', [20, 10, 30, 60])
  })

  it('点击取消/×/遮罩/Esc 关闭弹窗且不提交', () => {
    const onConfirm = vi.fn()
    const onClose = vi.fn()
    render(
      <IndicatorModal indicators={defaultIndicators()} t={createT('zh-CN')} onClose={onClose} onConfirm={onConfirm} />
    )
    fireEvent.click(screen.getByText('取消'))
    expect(onClose).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByText('×'))
    expect(onClose).toHaveBeenCalledTimes(2)

    fireEvent.click(document.querySelector('#indicator-modal')!)
    expect(onClose).toHaveBeenCalledTimes(3)

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(4)

    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('英文环境下弹窗使用英文文案', () => {
    render(
      <IndicatorModal
        indicators={[{ name: 'MACD', paneId: 'indicator_pane_1', calcParams: [12, 26, 9] }]}
        t={createT('en-US')}
        onClose={vi.fn()}
        onConfirm={vi.fn()}
      />
    )
    expect(screen.getByText('Indicator Settings')).toBeTruthy()
    expect(getSelect().options[0].textContent).toBe('MACD (Sub)')
    expect(getParamLabels()).toEqual(['Fast', 'Slow', 'Signal'])
    expect(screen.getByText('OK')).toBeTruthy()
  })

  it('卸载后清理 Esc 监听', async () => {
    const onClose = vi.fn()
    const { unmount } = render(
      <IndicatorModal indicators={defaultIndicators()} t={createT('zh-CN')} onClose={onClose} onConfirm={vi.fn()} />
    )
    unmount()
    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => {
      expect(onClose).not.toHaveBeenCalled()
    })
  })
})
