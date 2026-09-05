import { HardDriveDownload, ShieldCheck, TriangleAlert } from 'lucide-react'

import { STORAGE_DURABILITY, type StorageDurability } from '@/core'
import { Alert, AlertDescription, AlertTitle } from '@/shared/ui'

interface StorageDurabilityAlertProps {
  readonly durability: StorageDurability | null

  /**
   * Whether to show a message when storage is fully durable.
   *
   * Default no: saying "all is well" on every screen trains people
   * not to read messages. On the backup screen it belongs: that is
   * where the owner decides whether the wallet is protected enough.
   */
  readonly showWhenPersistent?: boolean
}

/**
 * How reliably the wallet data is stored.
 *
 * WHY SHOW THIS AT ALL. The browser may evict site data when space
 * is short. For an ordinary site that is a lost cache; for a wallet
 * it is a lost encrypted seed phrase — i.e. funds, if the phrase
 * is not on paper. The owner cannot decide what to do without
 * knowing the risk.
 *
 * THREE STATES ARE DISTINGUISHED BECAUSE THEY NEED DIFFERENT THINGS.
 * "The browser promised not to delete", "data persists but there is
 * no promise", and "data dies when the tab closes" are three
 * positions, and collapsing them into one warning either scares
 * without cause or stays silent where silence is not allowed.
 *
 * IN EVERY CASE THE CONCLUSION IS THE SAME: a seed phrase written
 * on paper remains the only protection that does not depend on the
 * browser. That is what is said.
 */
export function StorageDurabilityAlert({
  durability,
  showWhenPersistent = false,
}: StorageDurabilityAlertProps) {
  /* State has not been read yet. Showing a warning before the
     answer would scare the owner with something that may not exist. */
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
