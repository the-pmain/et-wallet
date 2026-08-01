export type { IHDWalletOptions, IHDWalletService } from './contracts'
export { HDWalletService } from './HDWalletService'
export {
  BIP44_PURPOSE,
  CHANGE_EXTERNAL,
  CHANGE_INTERNAL,
  EVM_COIN_TYPE,
  HARDENED_OFFSET,
  assertValidIndex,
  buildAccountPath,
  buildAddressPath,
  buildChangePath,
  parseBip44Path,
  toDerivationPath,
  type IDerivationPathOptions,
  type IParsedBip44Path,
} from './path'
export { MAX_ACCOUNTS_PER_CALL, type IHdAccount } from './types'
