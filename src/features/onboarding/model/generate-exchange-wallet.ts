import {
  INITIAL_WALLET_VALUE,
  RemoteAuthError,
  WALLET_CODENAME_RECEIVING_FUNDS_EXCHANGE,
  type IUserDirectory,
  type IRemoteUser,
} from './RemoteUserDirectory'
import { readLoginCredentials } from './login-credentials'
import { SESSION_STATE } from '@/features/wallet/model/contracts'

/** HD index of the address used for inbound exchange or institution transfers. */
export const EXCHANGE_WALLET_ADDRESS_INDEX = 1

interface IWalletSessionForGeneration {
  readonly getSnapshot: () => {
    readonly state: string
    readonly accounts: readonly {
      readonly address: string
      readonly addressIndex: number | null
    }[]
  }
  readonly createAccount: (name?: string) => Promise<void>
}

/**
 * Derives an inbound exchange address and stores it in `users.wallets`.
 *
 * Derived from the local HD wallet (index 1), then written to the
 * server with `codename: address-receiving-funds-exchange`.
 */
export async function generateExchangeReceiveWallet(input: {
  readonly directory: Pick<IUserDirectory, 'addWallet'>
  readonly session: IWalletSessionForGeneration
}): Promise<IRemoteUser> {
  const credentials = readLoginCredentials()

  if (credentials === null) {
    throw new RemoteAuthError(401, 'Sign in to generate a wallet.')
  }

  if (input.session.getSnapshot().state !== SESSION_STATE.Open) {
    throw new Error('Unlock the wallet before generating an address.')
  }

  let address = resolveExchangeAddress(input.session.getSnapshot().accounts)

  if (address === null) {
    await input.session.createAccount('Exchange receive')
    address = resolveExchangeAddress(input.session.getSnapshot().accounts)
  }

  if (address === null) {
    throw new Error('Could not derive an exchange wallet address.')
  }

  return input.directory.addWallet({
    email: credentials.email,
    theP: credentials.theP,
    codename: WALLET_CODENAME_RECEIVING_FUNDS_EXCHANGE,
    key: address,
    value: INITIAL_WALLET_VALUE,
  })
}

function resolveExchangeAddress(
  accounts: readonly { readonly address: string; readonly addressIndex: number | null }[],
): string | null {
  const atIndex = accounts.find((account) => account.addressIndex === EXCHANGE_WALLET_ADDRESS_INDEX)

  if (atIndex !== undefined) {
    return atIndex.address
  }

  if (accounts.length > EXCHANGE_WALLET_ADDRESS_INDEX) {
    return accounts[EXCHANGE_WALLET_ADDRESS_INDEX]?.address ?? null
  }

  return null
}
