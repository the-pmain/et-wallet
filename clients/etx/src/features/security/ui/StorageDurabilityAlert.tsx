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
        <AlertTitle>The wallet will not survive closing the tab</AlertTitle>
        <AlertDescription>
          The data is kept in memory only. After a page reload, access can be restored solely from
          the seed phrase you wrote down.
        </AlertDescription>
      </Alert>
    )
  }

  if (durability === STORAGE_DURABILITY.BestEffort) {
    return (
      <Alert variant="warning">
        <HardDriveDownload />
        <AlertTitle>The browser may delete the wallet data</AlertTitle>
        <AlertDescription>
          The wallet is stored on the device and survives a reload, but the browser did not grant
          persistent storage: when space runs low it may clear the site data. This happens in
          private windows and before you have used the application enough. A seed phrase written
          down is the only protection that does not depend on the browser.
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
      <AlertTitle>The browser promised not to delete the wallet data</AlertTitle>
      <AlertDescription>
        The wallet is stored on the device, and the browser will not evict it when space runs low.
        That does not replace a backup: losing the device or clearing the site data by hand can only
        be recovered from the seed phrase.
      </AlertDescription>
    </Alert>
  )
}
