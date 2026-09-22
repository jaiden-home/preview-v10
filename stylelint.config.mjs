/** @type {import('stylelint').Config} */
export default {
  ignoreFiles: ['node_modules/**', '.next/**'],
  rules: {
    // UI_SPEC §2 强约束：组件区禁止硬编码颜色/圆角/字族，一律引用设计令牌。
    // 令牌唯一定义处（globals.css 顶部 #app / #app.dark 变量块）已用 stylelint-disable 注释圈定豁免。
    'color-no-hex': true,
    'declaration-property-value-allowed-list': {
      // 圆角只允许令牌 + 登记过的字面量（6px 分段内部按钮 / 50% 圆形 / 999px 胶囊 / 0 组合角）
      'border-radius': ['/^var\\(--radius-/', '6px', '50%', '999px', '0'],
      // 字族只允许令牌（--font-sans / --font-num）
      'font-family': ['/^var\\(--font-/']
    }
  }
}
