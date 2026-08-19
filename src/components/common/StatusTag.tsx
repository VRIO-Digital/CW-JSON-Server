import {
  CheckCircleOutlined,
  CloseCircleOutlined,
  ExclamationCircleOutlined,
  InfoCircleOutlined,
  SyncOutlined,
} from '@ant-design/icons'
import { Tag } from 'antd'
import type { ReactNode } from 'react'
import type { Tone } from '../../types'

/*
 * antd Tag, keyed off the reserved tone vocabulary. Every tag carries an icon
 * and a text label, so state never depends on colour alone.
 */
const TONE: Record<Tone, { color: string; icon: ReactNode }> = {
  good: { color: 'success', icon: <CheckCircleOutlined /> },
  warn: { color: 'warning', icon: <ExclamationCircleOutlined /> },
  crit: { color: 'error', icon: <CloseCircleOutlined /> },
  info: { color: 'processing', icon: <SyncOutlined spin /> },
  neutral: { color: 'default', icon: <InfoCircleOutlined /> },
}

export default function StatusTag({
  tone,
  children,
}: {
  tone: Tone
  children: ReactNode
}) {
  const { color, icon } = TONE[tone]
  return (
    <Tag color={color} icon={icon} variant="filled">
      {children}
    </Tag>
  )
}
