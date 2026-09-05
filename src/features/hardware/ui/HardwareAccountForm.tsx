import { Usb } from 'lucide-react'
import { useState } from 'react'

import {
  HardwareDeviceError,
  KEYRING_TYPE,
  LedgerDevice,
  buildAddressPath,
  type Address,
  type DerivationPath,
} from '@/core'
import { useWallet, useWalletSnapshot } from '@/features/wallet'
import { Alert, AlertDescription, AlertTitle, Button, Card, CardContent } from '@/shared/ui'

import { WebHidTransport } from '../model/WebHidTransport'

/**
 * How many addresses to show at a time.
 *
 * Each needs a separate device round-trip and takes noticeable
 * time. Five covers the usual case; the rest come on demand.
 */
const PAGE_SIZE = 5

interface IDeviceAddress {
  readonly address: Address
  readonly path: DerivationPath
}

/**
 * Connect a hardware wallet.
 *
 * WHAT DOES NOT LAND HERE. No key, no seed phrase: the device
 * returns addresses only. The added account stores the address
 * and path, and without the device it will sign nothing — that
 * is its defining property, not an implementation limit.
 *
 * ADDRESSES ARE READ WITHOUT CONFIRMATION ON THE DEVICE SCREEN.
 * Asking for it on each of five addresses would mean five button
 * presses just for a list; confirmation is requested when the
 * address is accepted as theirs — on add.
 */
export function HardwareAccountForm() {
  const session = useWallet()
  const snapshot = useWalletSnapshot()

  const [addresses, setAddresses] = useState<readonly IDeviceAddress[]>([])
  const [isBusy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [added, setAdded] = useState<string | null>(null)

  /* Already-added addresses: offering them again is pointless. */
  const known = new Set(snapshot.accounts.map((account) => account.address.toLowerCase()))

  async function run(action: () => Promise<void>): Promise<void> {
    setBusy(true)
    setError(null)

    try {
      await action()
    } catch (caught) {
      /* A refusal on the device and a device failure look
         different and need different handling. The reason is
         shown verbatim. */
      setError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setBusy(false)
    }
  }

  function readAddresses(from: number): void {
    void run(async () => {
      const device = new LedgerDevice(await WebHidTransport.connect())
      const found: IDeviceAddress[] = []

      for (let index = from; index < from + PAGE_SIZE; index += 1) {
        const path = buildAddressPath(index)

        found.push(await device.getAddress(path))
      }

      setAddresses((current) => [...current, ...found])
    })
  }

  function add(entry: IDeviceAddress): void {
    void run(async () => {
      /* CONFIRMATION ON THE DEVICE SCREEN IS REQUIRED. The address
         shown by this page could have been swapped: the page loads
         from a server, the device screen does not. Matching what
         the person sees here with what the device shows is the one
         thing a swapped page cannot do. */
      const device = new LedgerDevice(await WebHidTransport.connect())
      const confirmed = await device.getAddress(entry.path, true)

      if (confirmed.address !== entry.address) {
        throw new HardwareDeviceError('the device showed a different address')
      }

      const account = await session.addHardwareAccount({
        type: KEYRING_TYPE.Ledger,
        address: confirmed.address,
        path: entry.path,
      })

      setAdded(account.name)
    })
  }

  return (
    <Card>
      <CardContent className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <span className="text-sm font-medium">Hardware wallet</span>
          <span className="text-xs text-muted-foreground">
            The key stays inside the device and never reaches this page. Every signature is
            confirmed on the device screen.
          </span>
        </div>

        {error === null ? null : (
          <Alert variant="warning">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {added === null ? null : (
          <Alert>
            <AlertTitle>{added} was added</AlertTitle>
            <AlertDescription>
              Keep the device at hand: without it this account cannot sign anything.
            </AlertDescription>
          </Alert>
        )}

        {addresses.length === 0 ? (
          <>
            <Button
              variant="outline"
              disabled={isBusy}
              onClick={() => {
                readAddresses(0)
              }}
            >
              <Usb className="size-4" aria-hidden />
              {isBusy ? 'Waiting for the device…' : 'Connect a Ledger'}
            </Button>

            <p className="text-xs text-muted-foreground">
              Unlock the device and open the Ethereum application on it first. The browser will ask
              which device to give access to.
            </p>
          </>
        ) : (
          <ul className="flex flex-col gap-2">
            {addresses.map((entry) => (
              <li
                key={entry.path}
                className="flex items-center justify-between gap-2 rounded-xl border p-2"
              >
                <div className="flex min-w-0 flex-col">
                  <span className="truncate font-mono text-xs">{entry.address}</span>
                  <span className="text-xs text-muted-foreground">{entry.path}</span>
                </div>

                <Button
                  size="sm"
                  variant="outline"
                  disabled={isBusy || known.has(entry.address.toLowerCase())}
                  onClick={() => {
                    add(entry)
                  }}
                >
                  {known.has(entry.address.toLowerCase()) ? 'Added' : 'Add'}
                </Button>
              </li>
            ))}
          </ul>
        )}

        {addresses.length === 0 ? null : (
          <Button
            variant="ghost"
            size="sm"
            disabled={isBusy}
            onClick={() => {
              readAddresses(addresses.length)
            }}
          >
            Show more addresses
          </Button>
        )}
      </CardContent>
    </Card>
  )
}
