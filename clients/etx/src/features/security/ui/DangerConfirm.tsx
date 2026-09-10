import { AlertTriangle } from 'lucide-react'
import { useState, type ReactNode } from 'react'

import { Alert, AlertDescription, AlertTitle, Button, Checkbox, Label } from '@/shared/ui'

interface DangerConfirmProps {
  readonly title: string

  /** Что произойдёт и почему это необратимо. */
  readonly description: ReactNode

  /** Текст отметки, которую пользователь обязан поставить. */
  readonly acknowledgement: string

  /** Подпись кнопки, выполняющей действие. */
  readonly confirmLabel: string

  readonly isBusy?: boolean
  readonly onConfirm: () => void
  readonly onCancel: () => void
}

/**
 * Подтверждение необратимого действия.
 *
 * ЕДИНЫЙ МЕХАНИЗМ ВМЕСТО РАЗРОЗНЕННЫХ ПРЕДУПРЕЖДЕНИЙ. Опасные действия
 * разбросаны по экранам — удаление сети, отзыв согласия, сброс
 * кошелька, — и каждое было оформлено по-своему. Разное оформление
 * одинаковых по последствиям действий учит не читать: пользователь
 * запоминает вид, а не смысл.
 *
 * ОТМЕТКА, А НЕ ПРОСТО КНОПКА. Одна кнопка отсекает промах пальцем,
 * но не отсекает механическое нажатие не читая. Отметка требует
 * второго, осознанного движения.
 *
 * ДЕЙСТВИЕ НЕ ВЫДЕЛЕНО ВИЗУАЛЬНО КАК ОСНОВНОЕ. Основной остаётся
 * отмена: оформление, приглашающее нажать опасное, — это подталкивание
 * к потере средств.
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
