/**
 * Registry of core error codes.
 *
 * A single list instead of string literals scattered across classes is
 * needed for three reasons:
 * - the UI maps a code to a message in the user's language, so the full
 *   set of codes must be visible in one place;
 * - the compiler will not allow a typo in a handled code;
 * - a duplicated code on two different errors becomes obvious immediately.
 *
 * A const object instead of `enum`: `enum` emits runtime code and is
 * forbidden by `erasableSyntaxOnly` in the stage-1 tsconfig.
 */
export const ERROR_CODE = {
  /* --- General --- */
  NotImplemented: 'NOT_IMPLEMENTED',
  InvalidArgument: 'INVALID_ARGUMENT',
  NotInitialized: 'NOT_INITIALIZED',
  Internal: 'INTERNAL',

  /* --- Wallet and access --- */
  WalletLocked: 'WALLET_LOCKED',
  WalletNotInitialized: 'WALLET_NOT_INITIALIZED',
  WalletAlreadyInitialized: 'WALLET_ALREADY_INITIALIZED',
  InvalidPassword: 'INVALID_PASSWORD',
  TooManyAttempts: 'TOO_MANY_ATTEMPTS',
  TransactionNotReplaceable: 'TRANSACTION_NOT_REPLACEABLE',
  InsufficientTokenBalance: 'INSUFFICIENT_TOKEN_BALANCE',
  NftNotOwned: 'NFT_NOT_OWNED',
  WeakPassword: 'WEAK_PASSWORD',
  InvalidMnemonic: 'INVALID_MNEMONIC',
  InvalidPrivateKey: 'INVALID_PRIVATE_KEY',
  InvalidDerivationPath: 'INVALID_DERIVATION_PATH',
  InvalidExtendedKey: 'INVALID_EXTENDED_KEY',
  InvalidAddress: 'INVALID_ADDRESS',
  InvalidPublicKey: 'INVALID_PUBLIC_KEY',
  AddressChecksumMismatch: 'ADDRESS_CHECKSUM_MISMATCH',

  /* --- Accounts and keyrings --- */
  AccountNotFound: 'ACCOUNT_NOT_FOUND',
  AccountAlreadyExists: 'ACCOUNT_ALREADY_EXISTS',
  AccountNotRemovable: 'ACCOUNT_NOT_REMOVABLE',
  KeyringNotFound: 'KEYRING_NOT_FOUND',
  KeyringCannotSign: 'KEYRING_CANNOT_SIGN',
  ExportNotPermitted: 'EXPORT_NOT_PERMITTED',

  /* --- Encryption --- */
  RandomnessUnavailable: 'RANDOMNESS_UNAVAILABLE',
  DecryptionFailed: 'DECRYPTION_FAILED',
  VaultCorrupted: 'VAULT_CORRUPTED',
  UnsupportedVaultVersion: 'UNSUPPORTED_VAULT_VERSION',
  SecretBufferWiped: 'SECRET_BUFFER_WIPED',

  /* --- Storage --- */
  StorageUnavailable: 'STORAGE_UNAVAILABLE',
  StorageWriteFailed: 'STORAGE_WRITE_FAILED',
  StorageReadFailed: 'STORAGE_READ_FAILED',
  MigrationFailed: 'MIGRATION_FAILED',

  /* --- Network and provider --- */
  NetworkNotFound: 'NETWORK_NOT_FOUND',
  NetworkAlreadyExists: 'NETWORK_ALREADY_EXISTS',
  BuiltInNetworkImmutable: 'BUILT_IN_NETWORK_IMMUTABLE',
  NetworkImpersonation: 'NETWORK_IMPERSONATION',
  TokenImpersonation: 'TOKEN_IMPERSONATION',
  InsecureRpcUrl: 'INSECURE_RPC_URL',
  InvalidRpcUrl: 'INVALID_RPC_URL',
  ChainIdMismatch: 'CHAIN_ID_MISMATCH',
  ProviderUnavailable: 'PROVIDER_UNAVAILABLE',
  RpcError: 'RPC_ERROR',

  /* --- Transactions --- */
  InsufficientFunds: 'INSUFFICIENT_FUNDS',
  GasEstimationFailed: 'GAS_ESTIMATION_FAILED',
  NonceTooLow: 'NONCE_TOO_LOW',
  TransactionNotFound: 'TRANSACTION_NOT_FOUND',
  TransactionUnderpriced: 'TRANSACTION_UNDERPRICED',
  UserRejected: 'USER_REJECTED',

  /* --- Tokens --- */
  TokenNotFound: 'TOKEN_NOT_FOUND',
  InvalidTokenContract: 'INVALID_TOKEN_CONTRACT',
  UnsupportedTokenStandard: 'UNSUPPORTED_TOKEN_STANDARD',
} as const

export type ErrorCode = (typeof ERROR_CODE)[keyof typeof ERROR_CODE]
