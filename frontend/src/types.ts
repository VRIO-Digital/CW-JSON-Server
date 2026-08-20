/** Reserved state vocabulary. Rendered by StatusTag as colour + icon + label. */
export type Tone = 'good' | 'warn' | 'crit' | 'info' | 'neutral'

export interface Stat {
  label: string
  value: string
  note?: string
  tone?: Exclude<Tone, 'info'>
}
