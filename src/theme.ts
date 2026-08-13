import type { ThemeConfig } from 'antd'

export const BRAND = '#f4562b'
export const BRAND_SOFT = '#fdeae4'
/**
 * The brand, darkened until it can be *read* on its own tint.
 *
 * `BRAND` on `BRAND_SOFT` measures **2.91:1** — below the 4.5 body text needs, which would have made a
 * selected item the hardest thing on the control to read. This is the same hue at 5.96:1. Use it wherever
 * brand-coloured text sits on `BRAND_SOFT`; `BRAND` itself is for fills, borders and marks, where 3:1 is
 * the bar. `check-docs` recomputes both ratios.
 */
export const BRAND_INK = '#9e3819'

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
    /*
     * The persona picker, and anything else segmented.
     *
     * antd marks selection with a **white thumb on a near-white track**, which at this size is almost
     * invisible — a reader could not tell which persona they had clicked. The app already has a language
     * for "this one is selected": the sidebar's `Menu` above uses a brand-soft fill with brand text, so
     * this borrows it rather than inventing a second signal. Brand, not a status hue — being selected is
     * not a state of the world, and `STATUS.good/warn/crit` stay reserved.
     *
     * `trackBg` is the page ground rather than `SURFACE_2`, so the unselected items read as *inset* and the
     * selected one as lifted; on a white card a near-white track gave the whole control no edge at all.
     */
    Segmented: {
      trackBg: BG,
      itemColor: INK_2,
      itemHoverColor: INK,
      itemSelectedBg: BRAND_SOFT,
      itemSelectedColor: BRAND_INK,
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
