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
 * Заполнение ячеек `wallets`, показанных на «Получить».
 *
 * ПОЧЕМУ АДРЕС ВЫВОДИТ СЕРВЕР. Кнопка принадлежит любому вошедшему,
 * в том числе открывшему кабинет по почте в браузере, который
 * кошелька никогда не держал. Там хранилище заперто, сессия не
 * открывается, и выводить адрес на устройстве не из чего. Сервер
 * хранит восстановительную фразу записи и выводит адрес тем же
 * путём BIP-44, что и кошелёк, поэтому ячейка совпадает с тем, что
 * показывает собственное устройство владельца.
 *
 * Локальный кошелёк — запасной путь, а не правило: он нужен только
 * для записи, из фразы которой сервер вывести не может, — строки,
 * заведённой до появления столбца `seed_phrase`.
 */

/** HD-индекс основного адреса для входящих переводов. */
export const RECEIVING_FUNDS_WALLET_ADDRESS_INDEX = 0

/** HD-индекс адреса для переводов с биржи или учреждения. */
export const EXCHANGE_WALLET_ADDRESS_INDEX = 1

/** Сервер отказал: вывести адрес из этой записи он не может. */
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

/** Записывает `address-receiving-funds` по HD-индексу 0. */
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

/** Записывает `address-receiving-funds-exchange` по HD-индексу 1. */
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

/** `null` — кошелька на устройстве нет либо он остался заперт. */
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
      /* Запертое хранилище здесь — ожидаемое состояние, а не сбой:
         о причине пользователю уже сказал ответ сервера. */
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
