import type { ThemeConfig } from 'antd'

export const BRAND = '#f4562b'
export const BRAND_SOFT = '#fdeae4'

/**
 * The 4px spacing scale, for antd props that take numbers (gutter, gap, Space
 * size). Mirrors the --sp-* custom properties in index.css — change both.
 */
export const SP = {
  xs: 4,
  sm: 8,
  md: 12,
  base: 16,
  lg: 20,
  xl: 24,
  xxl: 32,
} as const

const INK = '#0f1729'
const INK_NAV = '#22355c'
const INK_2 = '#4b5a75'
const INK_3 = '#8994a8'
const BORDER = '#e9ecf1'
const SURFACE = '#ffffff'
const SURFACE_2 = '#fafbfc'
const BG = '#f7f8fa'

/*
 * Status hues are darkened from antd's defaults so label text clears AA on the
 * light tag backgrounds antd derives from them. They stay reserved for state —
 * never reused as a decorative accent.
 */
export const STATUS = {
  good: '#0f7b4f',
  warn: '#b45309',
  crit: '#b42318',
} as const

export const antdTheme: ThemeConfig = {
  token: {
    colorPrimary: BRAND,
    colorInfo: BRAND,
    colorSuccess: STATUS.good,
    colorWarning: STATUS.warn,
    colorError: STATUS.crit,
    colorText: INK,
    colorTextSecondary: INK_2,
    colorTextTertiary: INK_3,
    colorTextDescription: INK_3,
    colorBorderSecondary: BORDER,
    colorBgLayout: BG,
    colorBgContainer: SURFACE,
    borderRadius: 8,
    borderRadiusLG: 10,
    fontSize: 14,
    fontFamily:
      "system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', sans-serif",
    controlHeight: 34,
  },
  components: {
    Layout: {
      bodyBg: BG,
      siderBg: SURFACE,
      lightSiderBg: SURFACE,
    },
    Menu: {
      itemHeight: 44,
      itemBorderRadius: 10,
      itemMarginInline: 12,
      itemPaddingInline: 14,
      itemColor: INK_NAV,
      itemHoverBg: SURFACE_2,
      itemHoverColor: INK,
      itemSelectedBg: BRAND_SOFT,
      itemSelectedColor: BRAND,
    },
    Card: {
      headerBg: SURFACE,
      headerFontSize: 15,
      headerHeight: 52,
      bodyPadding: 0,
    },
    Table: {
      headerBg: SURFACE_2,
      headerColor: INK_3,
      borderColor: BORDER,
      rowHoverBg: SURFACE_2,
      cellPaddingBlock: 13,
      cellPaddingInline: 18,
      cellFontSize: 13.5,
    },
    Statistic: {
      contentFontSize: 27,
    },
  },
}
