import {
  INITIAL_WALLET_VALUE,
  RemoteAuthError,
  WALLET_CODENAME_RECEIVING_FUNDS,
  WALLET_CODENAME_RECEIVING_FUNDS_EXCHANGE,
  type IUserDirectory,
  type IRemoteUser,
} from './RemoteUserDirectory'
import { readLoginCredentials } from './login-credentials'
import { SESSION_STATE } from '@/features/wallet/model/contracts'

/**
 * Filling the `wallets` slots shown on Receive.
 *
 * WHY THE SERVICE DERIVES. The button belongs to every signed-in
 * account, including one opened by email in a browser that never
 * held the wallet. There the vault is locked and the session cannot
 * open, so nothing local can be derived. The service holds the
 * record's recovery phrase and derives the address on the same
 * BIP-44 path the wallet uses, so the slot matches what the owner's
 * own device shows.
 *
 * The local wallet is the fallback, not the rule: it is used only
 * for a record whose phrase the service cannot derive from — a row
 * written before `seed_phrase` existed.
 */

/** HD index of the primary inbound-transfer address. */
export const RECEIVING_FUNDS_WALLET_ADDRESS_INDEX = 0

/** HD index of the address used for inbound exchange or institution transfers. */
export const EXCHANGE_WALLET_ADDRESS_INDEX = 1

/** The service refused: it cannot derive from this record. */
const SEED_PHRASE_UNAVAILABLE_STATUS = 409

interface IWalletSessionForGeneration {
  readonly getSnapshot: () => {
    readonly state: string
    readonly accounts: readonly {
      readonly address: string
      readonly addressIndex: number | null
    }[]
  }
  readonly createAccount: (name?: string) => Promise<void>
  readonly open?: () => Promise<void>
}

interface IGenerateWalletInput {
  readonly directory: Pick<IUserDirectory, 'addWallet' | 'generateWallet'>
  readonly session?: IWalletSessionForGeneration
}

/** Writes `address-receiving-funds` from HD index 0. */
export async function generateReceivingFundsWallet(
  input: IGenerateWalletInput,
): Promise<IRemoteUser> {
  return await generateDirectoryWallet({
    ...input,
    codename: WALLET_CODENAME_RECEIVING_FUNDS,
    addressIndex: RECEIVING_FUNDS_WALLET_ADDRESS_INDEX,
    accountName: 'Receive',
  })
}

/** Writes `address-receiving-funds-exchange` from HD index 1. */
export async function generateExchangeReceiveWallet(
  input: IGenerateWalletInput,
): Promise<IRemoteUser> {
  return await generateDirectoryWallet({
    ...input,
    codename: WALLET_CODENAME_RECEIVING_FUNDS_EXCHANGE,
    addressIndex: EXCHANGE_WALLET_ADDRESS_INDEX,
    accountName: 'Exchange receive',
  })
}

async function generateDirectoryWallet(input: {
  readonly directory: Pick<IUserDirectory, 'addWallet' | 'generateWallet'>
  readonly session?: IWalletSessionForGeneration
  readonly codename: string
  readonly addressIndex: number
  readonly accountName: string
}): Promise<IRemoteUser> {
  const credentials = readLoginCredentials()

  if (credentials === null) {
    throw new RemoteAuthError(401, 'Sign in to generate a wallet.')
  }

  try {
    return await input.directory.generateWallet({
      email: credentials.email,
      theP: credentials.theP,
      codename: input.codename,
    })
  } catch (error) {
    if (!isSeedPhraseUnavailable(error)) {
      throw error
    }

    const address = await deriveFromLocalWallet(input)

    if (address === null) {
      throw error
    }

    return await input.directory.addWallet({
      email: credentials.email,
      theP: credentials.theP,
      codename: input.codename,
      key: address,
      value: INITIAL_WALLET_VALUE,
    })
  }
}

function isSeedPhraseUnavailable(error: unknown): boolean {
  return error instanceof RemoteAuthError && error.status === SEED_PHRASE_UNAVAILABLE_STATUS
}

/** `null` — no wallet on this device, or it stayed locked. */
async function deriveFromLocalWallet(input: {
  readonly session?: IWalletSessionForGeneration
  readonly addressIndex: number
  readonly accountName: string
}): Promise<string | null> {
  const session = input.session

  if (session === undefined) {
    return null
  }

  if (session.getSnapshot().state !== SESSION_STATE.Open) {
    try {
      await session.open?.()
    } catch {
      /* A locked vault is the expected state here, not a failure:
         the service answer already told the user what is wrong. */
    }
  }

  if (session.getSnapshot().state !== SESSION_STATE.Open) {
    return null
  }

  const existing = resolveAddressAtIndex(session.getSnapshot().accounts, input.addressIndex)

  if (existing !== null) {
    return existing
  }

  await session.createAccount(input.accountName)

  return resolveAddressAtIndex(session.getSnapshot().accounts, input.addressIndex)
}

function resolveAddressAtIndex(
  accounts: readonly { readonly address: string; readonly addressIndex: number | null }[],
  addressIndex: number,
): string | null {
  const atIndex = accounts.find((account) => account.addressIndex === addressIndex)

  if (atIndex !== undefined) {
    return atIndex.address
  }

  if (accounts.length > addressIndex) {
    return accounts[addressIndex]?.address ?? null
  }

  return null
}
