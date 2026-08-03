/**
 * Реестр кодов ошибок ядра.
 *
 * Единый список вместо строковых литералов, разбросанных по классам, нужен
 * по трём причинам:
 * - UI сопоставляет коду сообщение на языке пользователя, и полный перечень
 *   кодов должен быть виден в одном месте;
 * - компилятор не даст опечататься в коде при обработке;
 * - дублирование кода в двух разных ошибках станет заметно сразу.
 *
 * Объект-константа вместо `enum`: `enum` порождает рантайм-код и запрещён
 * настройкой `erasableSyntaxOnly` в tsconfig этапа 1.
 */
export const ERROR_CODE = {
  /* --- Общие --- */
  NotImplemented: 'NOT_IMPLEMENTED',
  InvalidArgument: 'INVALID_ARGUMENT',
  NotInitialized: 'NOT_INITIALIZED',
  Internal: 'INTERNAL',

  /* --- Кошелёк и доступ --- */
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

  /* --- Аккаунты и наборы ключей --- */
  AccountNotFound: 'ACCOUNT_NOT_FOUND',
  AccountAlreadyExists: 'ACCOUNT_ALREADY_EXISTS',
  AccountNotRemovable: 'ACCOUNT_NOT_REMOVABLE',
  KeyringNotFound: 'KEYRING_NOT_FOUND',
  KeyringCannotSign: 'KEYRING_CANNOT_SIGN',
  ExportNotPermitted: 'EXPORT_NOT_PERMITTED',

  /* --- Шифрование --- */
  RandomnessUnavailable: 'RANDOMNESS_UNAVAILABLE',
  DecryptionFailed: 'DECRYPTION_FAILED',
  VaultCorrupted: 'VAULT_CORRUPTED',
  UnsupportedVaultVersion: 'UNSUPPORTED_VAULT_VERSION',
  SecretBufferWiped: 'SECRET_BUFFER_WIPED',

  /* --- Хранилище --- */
  StorageUnavailable: 'STORAGE_UNAVAILABLE',
  StorageWriteFailed: 'STORAGE_WRITE_FAILED',
  StorageReadFailed: 'STORAGE_READ_FAILED',
  MigrationFailed: 'MIGRATION_FAILED',

  /* --- Сеть и провайдер --- */
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

  /* --- Транзакции --- */
  InsufficientFunds: 'INSUFFICIENT_FUNDS',
  GasEstimationFailed: 'GAS_ESTIMATION_FAILED',
  NonceTooLow: 'NONCE_TOO_LOW',
  TransactionNotFound: 'TRANSACTION_NOT_FOUND',
  TransactionUnderpriced: 'TRANSACTION_UNDERPRICED',
  UserRejected: 'USER_REJECTED',

  /* --- Токены --- */
  TokenNotFound: 'TOKEN_NOT_FOUND',
  InvalidTokenContract: 'INVALID_TOKEN_CONTRACT',
  UnsupportedTokenStandard: 'UNSUPPORTED_TOKEN_STANDARD',
} as const

export type ErrorCode = (typeof ERROR_CODE)[keyof typeof ERROR_CODE]
