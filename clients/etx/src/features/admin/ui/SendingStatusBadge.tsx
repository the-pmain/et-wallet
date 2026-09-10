import type { RemoteSendingStatus } from '@/features/onboarding'
import { Badge } from '@/shared/ui'

interface SendingStatusBadgeProps {
  readonly status: RemoteSendingStatus | null
}

/**
 * Цвет статуса перевода: pending — жёлтый, success — зелёный, failure — красный.
 */
export function SendingStatusBadge({ status }: SendingStatusBadgeProps) {
  if (status === 'success') {
    return (
      <Badge className="border-transparent bg-risk-low/15 text-risk-low capitalize">{status}</Badge>
    )
  }

  if (status === 'failure') {
    return (
      <Badge variant="danger" className="capitalize">
        {status}
      </Badge>
    )
  }

  if (status === 'pending') {
    return (
      <Badge variant="warning" className="capitalize">
        {status}
      </Badge>
    )
  }

  return (
    <Badge variant="outline" className="capitalize">
      unknown
    </Badge>
  )
}
