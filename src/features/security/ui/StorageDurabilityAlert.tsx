import { HardDriveDownload, ShieldCheck, TriangleAlert } from 'lucide-react'

import { STORAGE_DURABILITY, type StorageDurability } from '@/core'
import { Alert, AlertDescription, AlertTitle } from '@/shared/ui'

interface StorageDurabilityAlertProps {
  readonly durability: StorageDurability | null

  /**
   * Показывать ли сообщение при полностью надёжном хранилище.
   *
   * По умолчанию нет: сообщать «всё в порядке» на каждом экране —
   * способ приучить не читать сообщения. На экране резервной копии
   * оно уместно: там владелец как раз решает, достаточно ли защищён
   * его кошелёк.
   */
  readonly showWhenPersistent?: boolean
}

/**
 * Сообщение о том, насколько надёжно хранятся данные кошелька.
 *
 * ЗАЧЕМ ЭТО ВООБЩЕ ПОКАЗЫВАТЬ. Браузер вправе вытеснить данные сайта
 * при нехватке места. Для обычного сайта это потеря кэша, для кошелька —
 * потеря зашифрованной seed-фразы, то есть средств, если фраза
 * не записана на бумаге. Владелец не может принять решение о том,
 * что с этим делать, если не знает о риске.
 *
 * ТРИ СОСТОЯНИЯ РАЗЛИЧАЮТСЯ, ПОТОМУ ЧТО ТРЕБУЮТ РАЗНОГО. «Браузер
 * обещал не удалять», «данные сохраняются, но обещания нет» и «данные
 * исчезнут при закрытии вкладки» — три разных положения, и сведение их
 * к одному предупреждению либо пугает без нужды, либо молчит там,
 * где молчать нельзя.
 *
 * ВО ВСЕХ СЛУЧАЯХ ВЫВОД ОДИН: записанная на бумаге seed-фраза остаётся
 * единственной защитой, не зависящей от браузера. Об этом и говорится.
 */
export function StorageDurabilityAlert({
  durability,
  showWhenPersistent = false,
}: StorageDurabilityAlertProps) {
  /* Состояние ещё не прочитано. Показывать предупреждение до ответа
     значит пугать владельца тем, чего может не быть. */
  if (durability === null) {
    return null
  }

  if (durability === STORAGE_DURABILITY.Session) {
    return (
      <Alert variant="danger">
        <TriangleAlert />
        <AlertTitle>Кошелёк не переживёт закрытие вкладки</AlertTitle>
        <AlertDescription>
          Данные хранятся только в памяти. После перезагрузки страницы восстановить доступ можно
          будет исключительно по записанной seed-фразе.
        </AlertDescription>
      </Alert>
    )
  }

  if (durability === STORAGE_DURABILITY.BestEffort) {
    return (
      <Alert variant="warning">
        <HardDriveDownload />
        <AlertTitle>Браузер вправе удалить данные кошелька</AlertTitle>
        <AlertDescription>
          Кошелёк сохраняется на устройстве и переживает перезагрузку, но разрешения на постоянное
          хранение браузер не выдал: при нехватке места он может очистить данные сайта. Так бывает в
          приватном окне и до того, как вы достаточно поработали с приложением. Записанная
          seed-фраза — единственная защита, не зависящая от браузера.
        </AlertDescription>
      </Alert>
    )
  }

  if (!showWhenPersistent) {
    return null
  }

  return (
    <Alert>
      <ShieldCheck />
      <AlertTitle>Браузер обещал не удалять данные кошелька</AlertTitle>
      <AlertDescription>
        Кошелёк сохраняется на устройстве, и браузер не станет вытеснять его при нехватке места. Это
        не отменяет резервной копии: потеря устройства или очистка данных сайта вручную
        восстанавливаются только по seed-фразе.
      </AlertDescription>
    </Alert>
  )
}
