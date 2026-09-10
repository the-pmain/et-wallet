export {
  DEFAULT_GAP_LIMIT,
  MAX_SCANNED_ADDRESSES,
  discoverUsedAccounts,
  type AddressAt,
  type IDiscoveryOptions,
  type IDiscoveryResult,
} from './AccountDiscovery'
export { AccountManager, type IAccountManagerDependencies } from './AccountManager'
export { AccountRepository } from './AccountRepository'
export type { IAccountManager, IAccountRepository } from './contracts'
export {
  HD_KEYRING_ID,
  MAX_ACCOUNT_NAME_LENGTH,
  MIN_ACCOUNT_NAME_LENGTH,
  createAccountId,
  defaultAccountName,
  normalizeAccountName,
  toAccountId,
} from './identity'
export { ImportedKeyStore } from './ImportedKeyStore'
export type {
  AccountEventMap,
  IAccount,
  IAddHardwareAccountParams,
  ICreateAccountParams,
  IImportPrivateKeyParams,
} from './types'
