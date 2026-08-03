import { CircleAlert, CircleCheck, CircleHelp } from 'lucide-react'

import { PREFLIGHT_OUTCOME, type IPreflightResult } from '@/core'
import { Alert, AlertDescription, AlertTitle } from '@/shared/ui'

interface PreflightNoticeProps {
  readonly preflight: IPreflightResult
}

/**
 * Итог прогона вызова на узле до подписи.
 *
 * ПОКАЗЫВАЕТСЯ ВСЕГДА, ВКЛЮЧАЯ УСПЕХ. Соблазн молчать при удачном
 * исходе велик — меньше шума на экране, — но тогда отсутствие блока
 * означало бы сразу две разные вещи: «проверено» и «проверить
 * не удалось». Владелец средств обязан различать их, потому что
 * во втором случае он подписывает вслепую.
 *
 * УСПЕХ НЕ ОБЕЩАЕТ ВЫПОЛНЕНИЯ. Проверка говорит о состоянии цепи
 * на момент вызова: разрешение может быть отозвано, а средства
 * потрачены другой транзакцией до включения этой в блок. Написать
 * «транзакция пройдёт» значило бы дать обещание, которого кошелёк
 * выполнить не может.
 *
 * ОТКАЗ НЕ ЗАПРЕЩАЕТ ОТПРАВКУ. Узел мог отвечать по устаревшему
 * состоянию, а владелец — знать о встречной транзакции, которая всё
 * исправит. Решение остаётся за ним; дело кошелька — назвать причину
 * словами контракта, а не общим «не получилось».
 */
export function PreflightNotice({ preflight }: PreflightNoticeProps) {
  /* НЕЙТРАЛЬНОЕ ОФОРМЛЕНИЕ УСПЕХА, А НЕ «ЗЕЛЁНОЕ». Галка на зелёном
     фоне читается как обещание, что перевод состоится, тогда как
     проверен лишь текущий блок. */
  if (preflight.outcome === PREFLIGHT_OUTCOME.Passed) {
    return (
      <Alert>
        <CircleCheck />
        <AlertTitle>The node ran this call without an error</AlertTitle>
        <AlertDescription>
          Checked against the current state of the chain. It is not a promise: the state may change
          before the transaction is included in a block.
        </AlertDescription>
      </Alert>
    )
  }

  if (preflight.outcome === PREFLIGHT_OUTCOME.Unavailable) {
    return (
      <Alert variant="warning">
        <CircleHelp />
        <AlertTitle>The call could not be checked</AlertTitle>
        <AlertDescription>
          The node did not answer the trial run, so nothing is known about how this call ends. That
          is not the same as a successful check.
        </AlertDescription>
      </Alert>
    )
  }

  const isSilentRejection = preflight.outcome === PREFLIGHT_OUTCOME.RejectedByContract

  return (
    <Alert variant="danger">
      <CircleAlert />
      <AlertTitle>
        {isSilentRejection
          ? 'The contract refuses this call without failing it'
          : 'The call would fail'}
      </AlertTitle>
      <AlertDescription>
        {isSilentRejection ? (
          <>
            The contract answers "no" but does not revert: the transaction would be included in a
            block, the gas would be spent and nothing would move. It would look like a completed
            transfer.
          </>
        ) : (
          <>
            The node ran the call and it ended in a revert. Sending it would spend the gas and
            change nothing.
          </>
        )}

        {/* Причина приходит от контракта и показывается дословно.
            Пересказ своими словами убрал бы единственную зацепку:
            «недостаточно разрешения» и «получатель в чёрном списке»
            требуют разных действий. */}
        {preflight.reason === null ? null : <> The contract said: "{preflight.reason}".</>}
      </AlertDescription>
    </Alert>
  )
}
