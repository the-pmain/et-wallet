/**
 * Публичный API доменного ядра.
 *
 * Слои `features`, `pages` и `app` обращаются к ядру только через этот файл.
 * Импорт напрямую во внутренние модули (`@/core/keyring/Keyring`) технически
 * возможен, но нежелателен: он привязывает потребителя к текущей структуре
 * каталогов и мешает рефакторингу ядра.
 *
 * Ядро не зависит от React и от DOM. Это условие переноса его в service
 * worker manifest v3 без переписывания и проверяется правилом ESLint
 * `no-restricted-imports`.
 */

/* --- Примитивы предметной области --- */
export {
  MAX_CHAIN_ID,
  chainIdToHex,
  parseChainIdFromHex,
  toChainId,
  toTokenUnits,
  toWei,
} from './types'
export type {
  AccountId,
  Address,
  BlockHash,
  BlockTag,
  ChainId,
  DerivationPath,
  HexString,
  KeyringId,
  Timestamp,
  TokenUnits,
  TxHash,
  Unsubscribe,
  Wei,
} from './types'

/* --- События --- */
export { EventBus, type EventListener, type IEventBus, type IEventSource } from './events'

/* --- Платформенные зависимости --- */
export {
  ConsoleLogger,
  LOG_LEVEL,
  SystemClock,
  type IClock,
  type IConsoleLoggerOptions,
  type ILogger,
  type LogContext,
  type LogLevel,
} from './platform'

/* --- Ошибки --- */
export {
  AccountAlreadyExistsError,
  AccountNotFoundError,
  AddressChecksumMismatchError,
  AppError,
  BuiltInNetworkImmutableError,
  ChainIdMismatchError,
  DecryptionFailedError,
  ERROR_CODE,
  ExportNotPermittedError,
  GasEstimationFailedError,
  InsecureRpcUrlError,
  InsufficientFundsError,
  InsufficientTokenBalanceError,
  InvalidAddressError,
  InvalidArgumentError,
  InvalidDerivationPathError,
  InvalidExtendedKeyError,
  InvalidMnemonicError,
  InvalidPasswordError,
  InvalidPrivateKeyError,
  InvalidPublicKeyError,
  InvalidRpcUrlError,
  InvalidTokenContractError,
  KeyringCannotSignError,
  KeyringNotFoundError,
  MNEMONIC_INVALID_REASON,
  MigrationFailedError,
  NetworkAlreadyExistsError,
  NetworkImpersonationError,
  NetworkNotFoundError,
  NonceTooLowError,
  NotImplementedError,
  NotInitializedError,
  ProviderUnavailableError,
  RandomnessUnavailableError,
  RpcError,
  SecretBufferWipedError,
  StorageReadFailedError,
  StorageUnavailableError,
  StorageWriteFailedError,
  TokenNotFoundError,
  TooManyAttemptsError,
  TransactionNotFoundError,
  TransactionNotReplaceableError,
  TransactionUnderpricedError,
  UnsupportedTokenStandardError,
  UnsupportedVaultVersionError,
  UserRejectedError,
  VaultCorruptedError,
  WalletAlreadyInitializedError,
  WalletLockedError,
  WalletNotInitializedError,
  WeakPasswordError,
  isAppError,
  type ErrorCode,
  type MnemonicInvalidReason,
} from './errors'

/* --- Шифрование, секреты в памяти и защищённое хранилище --- */
export {
  AUTH_TAG_BITS,
  CIPHER_ALGORITHM,
  EncryptionKey,
  EncryptionService,
  IV_LENGTH,
  KDF_ALGORITHM,
  KEY_LENGTH,
  PAYLOAD_VERSION,
  PBKDF2_ITERATIONS,
  SALT_LENGTH,
  SecretBuffer,
  SecureStorage,
  createDefaultKdfParams,
  decodePayload,
  encodePayload,
  getRandomBytes,
  wipeBytes,
  withSecret,
  withSecretSync,
  type CipherAlgorithm,
  type IEncryptedPayload,
  type IEncryptedPayloadRecord,
  type IEncryptionService,
  type IKdfParams,
  type ISecretBuffer,
  type ISecureStorage,
  type KdfAlgorithm,
} from './encryption'

/* --- Адреса EVM --- */
export {
  ADDRESS_BYTE_LENGTH,
  AddressService,
  COMPRESSED_PUBLIC_KEY_LENGTH,
  DEAD_ADDRESS,
  PRIVATE_KEY_LENGTH,
  PUBLIC_KEY_FORMAT,
  RAW_PUBLIC_KEY_LENGTH,
  UNCOMPRESSED_PUBLIC_KEY_LENGTH,
  ZERO_ADDRESS,
  addressFromBytes,
  addressToBytes,
  areAddressesEqual,
  assertValidPrivateKey,
  isBurnAddress,
  isValidAddress,
  isValidPrivateKey,
  isZeroAddress,
  privateKeyToAddress,
  privateKeyToPublicKey,
  publicKeyToAddress,
  toAddress,
  toChecksumAddress,
  type IAddressService,
  type PublicKeyFormat,
} from './address'

/* --- HD-кошелёк BIP-32 / BIP-44 --- */
export {
  BIP44_PURPOSE,
  CHANGE_EXTERNAL,
  CHANGE_INTERNAL,
  EVM_COIN_TYPE,
  HARDENED_OFFSET,
  HDWalletService,
  MAX_ACCOUNTS_PER_CALL,
  assertValidIndex,
  buildAccountPath,
  buildAddressPath,
  buildChangePath,
  parseBip44Path,
  toDerivationPath,
  type IDerivationPathOptions,
  type IHDWalletOptions,
  type IHDWalletService,
  type IHdAccount,
  type IParsedBip44Path,
} from './hdwallet'

/* --- Политика экспорта секретов и паролей --- */
export {
  CHARACTER_CLASS,
  EXPORT_KIND,
  MAX_PASSWORD_LENGTH,
  MIN_PASSWORD_LENGTH,
  PASSWORD_ISSUE,
  PASSWORD_STRENGTH,
  AutoLockService,
  FREE_UNLOCK_ATTEMPTS,
  UnlockThrottle,
  unlockDelayFor,
  areEmailsEqual,
  safeText,
  toSafeText,
  type AutoLockEventMap,
  type IAutoLockDependencies,
  type IAutoLockOptions,
  type ISafeText,
  type IUnlockThrottleDependencies,
  type IUnlockThrottleState,
  assertAcceptablePassword,
  assessPassword,
  hdAccountScope,
  isValidEmail,
  normalizeEmail,
  importedKeyScope,
  type CharacterClass,
  type ExportScope,
  type IPasswordAssessment,
  type PasswordIssue,
  type PasswordStrength,
  EXPORT_RISK,
  EXPORT_RISK_ORDER,
  EXPORT_RISK_REASON,
  ExportAuditLog,
  ExportGuard,
  ExportPermit,
  SIGNING_ACCOUNT_INDEX,
  WALLET_SCOPE,
  WATCH_ONLY_ACCOUNT_INDEX,
  accountExportRequest,
  privateKeyExportRequest,
  riskLevel,
  type ExportKind,
  type ExportRisk,
  type ExportRiskReason,
  type IExportAuditLog,
  type IExportAuditStorage,
  type IExportGuard,
  type IExportRecord,
  type IExportRequest,
  type IExportRiskAssessment,
} from './security'

/* --- Имена ENS --- */
export {
  ENS_ADDR_SELECTOR,
  ENS_CHAIN_ID,
  ENS_NAME_SELECTOR,
  ENS_REGISTRY_ADDRESS,
  ENS_RESOLVER_SELECTOR,
  EnsService,
  beautifyEnsName,
  decodeAddressWord,
  decodeStringResult,
  encodeNodeCall,
  isAsciiEnsName,
  looksLikeEnsName,
  namehash,
  normalizeEnsName,
  reverseNode,
  type IEnsResolution,
  type IEnsService,
  type IEnsServiceDependencies,
} from './ens'

/* --- Резервное копирование секретов --- */
export {
  BackupManager,
  checkMnemonic,
  type IBackupManager,
  type IBackupManagerDependencies,
  type IMnemonicCheck,
} from './backup'

/* --- Подпись --- */
export {
  SigningService,
  assertTypedDataMatchesChain,
  hashTypedData,
  stripDomainType,
  type ISigningService,
  type SignableMessage,
} from './signing'

/* --- Мнемонические фразы BIP-39 --- */
export {
  BIP39_SEED_LENGTH,
  MNEMONIC_STRENGTH,
  MnemonicService,
  VALID_WORD_COUNTS,
  normalizeMnemonicInput,
  splitWords,
  type IMnemonicService,
  type IMnemonicValidationResult,
  type MnemonicStrength,
} from './mnemonic'

/* --- Хранилище --- */
export {
  IndexedDbStorageService,
  MemoryStorageService,
  SETTINGS_KEY,
  STORAGE_DURABILITY,
  STORAGE_NAMESPACE,
  VAULT_KEY,
  toStorageKey,
  type IIndexedDbStorageOptions,
  type IStorageEstimate,
  type IStorageMigration,
  type IStorageService,
  type IStorageTransaction,
  type StorageDurability,
  type StorageKey,
  type StorageNamespace,
} from './storage'

/* --- Сети --- */
export {
  BUILT_IN_CHAIN_ID,
  BUILT_IN_NETWORKS,
  DEFAULT_CHAIN_ID,
  NetworkRepository,
  NetworkService,
  assertValidExplorerUrl,
  assertValidRpcUrl,
  assertValidRpcUrls,
  findImpersonation,
  type IAddNetworkParams,
  type IImpersonation,
  type INativeCurrency,
  type INetworkConfig,
  type INetworkRepository,
  type INetworkService,
  type INetworkServiceDependencies,
  type NetworkEventMap,
} from './network'

/* --- Провайдер и транспорт к узлам --- */
export {
  AlchemyProvider,
  CustomRpcProvider,
  FailoverProvider,
  ProviderPool,
  PublicRpcProvider,
  RPC_PROVIDER_ID,
  RpcClient,
  LazyRpcClientFactory,
  RpcClientFactory,
  RpcManager,
  chainIdFromEthers,
  mapProviderError,
  type EndpointConnector,
  type EndpointSwitchListener,
  type IAlchemyProviderOptions,
  type ICallRequest,
  type IFailoverProviderDependencies,
  type IFeeData,
  type ILogEntry,
  type ILogFilter,
  type IProvider,
  type IProviderFactory,
  type IProviderPoolDependencies,
  type IProviderResolver,
  type ILazyRpcClientFactoryDependencies,
  type IRpcClientFactoryDependencies,
  type IRpcClientOptions,
  type IRpcEndpoint,
  type IRpcEndpointHealth,
  type IRpcManagerDependencies,
  type IRpcManagerOptions,
  type IRpcProvider,
  type IRpcRequest,
  type ITransactionReceipt,
  type ProviderEventMap,
  type RpcProviderId,
} from './provider'

/* --- Наборы ключей --- */
export {
  KEYRING_TYPE,
  type IHardwareKeyringOptions,
  type IHdKeyringOptions,
  type IKeyring,
  type IKeyringCapabilities,
  type IKeyringFactory,
  type IPrivateKeyKeyringOptions,
  type ISerializedKeyring,
  type IWatchOnlyKeyringOptions,
  type KeyringCreationOptions,
  type KeyringType,
} from './keyring'

/* --- Кошелёк --- */
export {
  LOCK_REASON,
  WALLET_STATUS,
  type ICreateWalletParams,
  type IImportWalletParams,
  type IVault,
  type IVaultContent,
  type IVaultRepository,
  type IWallet,
  type IWalletCreationResult,
  type LockReason,
  type WalletEventMap,
  type WalletStatus,
} from './wallet'

/* --- Аккаунты --- */
export {
  AccountManager,
  AccountRepository,
  HD_KEYRING_ID,
  ImportedKeyStore,
  MAX_ACCOUNT_NAME_LENGTH,
  MIN_ACCOUNT_NAME_LENGTH,
  createAccountId,
  defaultAccountName,
  normalizeAccountName,
  toAccountId,
  type AccountEventMap,
  type IAccount,
  type IAccountManager,
  type IAccountManagerDependencies,
  type IAccountRepository,
  type ICreateAccountParams,
  type IImportPrivateKeyParams,
} from './account'

/* --- Подключения к приложениям --- */
export {
  DAPP_REQUEST_KIND,
  DAPP_RISK,
  findDappRisks,
  isKnownSender,
  type DappRequestKind,
  type DappRequestPayload,
  type DappResponse,
  type DappRisk,
  type IDappMetadata,
  type IDappRequest,
  type IDappRiskFinding,
  type IDappSession,
  type IDappTransaction,
  type ISessionTransport,
  type ISignMessageRequest,
  type ISignTypedDataRequest,
  type ITransactionRequestFromDapp,
  type SessionTransportEventMap,
} from './dapp'

/* --- Курсы --- */
export {
  CoinGeckoPriceProvider,
  FIAT_CURRENCY,
  NullPriceProvider,
  PriceService,
  findCoinGeckoPlatform,
  priceRefKey,
  type FiatCurrency,
  type ICoinGeckoOptions,
  type ICoinGeckoPlatform,
  type IPriceProvider,
  type IPriceQuote,
  type IPriceRef,
  type IPriceService,
  type IPriceServiceDependencies,
  type PriceMap,
} from './price'

/* --- Портфель --- */
export {
  EMPTY_PORTFOLIO,
  buildPortfolio,
  toWholeUnits,
  type IPortfolioPosition,
  type IPortfolioSummary,
  type ITokenAmount,
} from './portfolio'

/* --- Токены --- */
export {
  BALANCE_OF_SELECTOR,
  DECIMALS_SELECTOR,
  NAME_SELECTOR,
  SYMBOL_SELECTOR,
  TOKEN_STANDARD,
  TRANSFER_SELECTOR,
  TokenRepository,
  TokenService,
  decodeString,
  decodeTransfer,
  decodeUint,
  encodeCall,
  encodeCallWithAddress,
  encodeTransfer,
  functionSelector,
  type IAddTokenParams,
  type IToken,
  type ITokenMetadata,
  type ITokenRef,
  type ITokenRepository,
  type ITokenService,
  type ITokenServiceDependencies,
  type TokenEventMap,
  type TokenStandard,
} from './token'

/* --- Балансы --- */
export {
  BalanceService,
  type BalanceEventMap,
  type IAccountBalances,
  type IBalance,
  type IBalanceService,
  type IBalanceServiceDependencies,
  type IBalanceServiceOptions,
} from './balance'

/* --- История переводов --- */
export {
  AlchemyHistoryProvider,
  HistoryService,
  LogScanHistoryProvider,
  TRANSFER_BATCH_TOPIC,
  TRANSFER_DIRECTION,
  TRANSFER_KIND,
  TRANSFER_SINGLE_TOPIC,
  TRANSFER_SOURCE,
  TRANSFER_TOPIC,
  addressToTopic,
  topicToAddress,
  type IHistoryLimits,
  type IHistoryPage,
  type IHistoryProvider,
  type IHistoryQuery,
  type IHistoryServiceDependencies,
  type ILogScanOptions,
  type ITransferAsset,
  type ITransferRecord,
  type TransferDirection,
  type TransferKind,
  type TransferSource,
} from './history'

/* --- Транзакции --- */
export {
  FEE_PRIORITY,
  RECIPIENT_RISK,
  TransactionRepository,
  TransactionService,
  findRecipientRisks,
  isContractAddress,
  type ITransactionServiceDependencies,
  type RecipientRisk,
  TRANSACTION_STATUS,
  TRANSACTION_TYPE,
  type FeePriority,
  type IFeeEstimate,
  type ISignableTransaction,
  type ISignedTransaction,
  type ITransactionRecord,
  type ITransactionRepository,
  type ITokenTransferRequest,
  type ITransactionRequest,
  type ITransactionService,
  type ITypedData,
  type ITypedDataDomain,
  type ITypedDataField,
  type TransactionEventMap,
  type TransactionStatus,
  type TransactionType,
} from './transaction'

/* --- Фасад и внедрение зависимостей --- */
export type { IWalletCoreConfig, IWalletManager, WalletCoreEventMap } from './manager'
export type { IWalletCoreDependencies, WalletCoreFactory } from './di'
