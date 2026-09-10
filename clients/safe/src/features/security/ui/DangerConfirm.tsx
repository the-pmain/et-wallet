import { AlertTriangle } from 'lucide-react'
import { useState, type ReactNode } from 'react'

import { Alert, AlertDescription, AlertTitle, Button, Checkbox, Label } from '@/shared/ui'

interface DangerConfirmProps {
  readonly title: string

  /** What will happen and why it is irreversible. */
  readonly description: ReactNode

  /** Text of the checkbox the user must tick. */
  readonly acknowledgement: string

  /** Label of the button that performs the action. */
  readonly confirmLabel: string

  readonly isBusy?: boolean
  readonly onConfirm: () => void
  readonly onCancel: () => void
}

/**
 * Confirm an irreversible action.
 *
 * ONE MECHANISM INSTEAD OF SCATTERED WARNINGS. Dangerous actions
 * are spread across screens — delete a network, revoke a grant,
 * reset the wallet — and each used to look different. Different
 * dressing for the same consequences trains people not to read:
 * they remember the look, not the meaning.
 *
 * A CHECKBOX, NOT JUST A BUTTON. One button stops a finger miss,
 * but not a mechanical click without reading. The checkbox needs
 * a second, deliberate movement.
 *
 * THE ACTION IS NOT STYLED AS PRIMARY. Cancel stays primary: a
 * look that invites the dangerous click is a nudge toward losing
 * funds.
 */
export function DangerConfirm({
  title,
  description,
  acknowledgement,
  confirmLabel,
  isBusy = false,
  onConfirm,
  onCancel,
}: DangerConfirmProps) {
  const [isAcknowledged, setAcknowledged] = useState(false)

  return (
    <div className="flex flex-col gap-4 rounded-xl border border-destructive/40 p-4">
      <Alert variant="danger">
        <AlertTriangle />
        <AlertTitle>{title}</AlertTitle>
        <AlertDescription>{description}</AlertDescription>
      </Alert>

      <Label className="items-start gap-3">
        <Checkbox
          checked={isAcknowledged}
          disabled={isBusy}
          onChange={(event) => {
            setAcknowledged(event.target.checked)
          }}
        />
        <span className="text-sm leading-snug font-normal">{acknowledgement}</span>
      </Label>

      <div className="flex gap-2">
        <Button variant="default" className="flex-1" disabled={isBusy} onClick={onCancel}>
          Cancel
        </Button>

        <Button
          variant="outline"
          className="flex-1 border-destructive text-destructive hover:bg-destructive/10"
          disabled={isBusy || !isAcknowledged}
          onClick={onConfirm}
        >
          {confirmLabel}
        </Button>
      </div>
    </div>
  )
}
