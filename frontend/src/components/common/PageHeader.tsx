import { Flex, Space, Typography } from 'antd'
import type { ReactNode } from 'react'
import { SP } from '../../theme'

export default function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string
  subtitle: string
  actions?: ReactNode
}) {
  return (
    <Flex
      align="flex-end"
      justify="space-between"
      gap={SP.base}
      wrap
      style={{ marginBottom: SP.xl }}
    >
      <div style={{ maxWidth: 720 }}>
        <Typography.Title level={3} style={{ margin: 0, letterSpacing: -0.4 }}>
          {title}
        </Typography.Title>
        <Typography.Text
          type="secondary"
          style={{ display: 'block', marginTop: SP.xs, fontSize: 13.5 }}
        >
          {subtitle}
        </Typography.Text>
      </div>
      {actions ? <Space size={SP.sm}>{actions}</Space> : null}
    </Flex>
  )
}
