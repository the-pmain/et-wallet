import type { Brand } from '@/shared/types'

/**
 * Storage record key.
 *
 * Branded so an arbitrary string cannot enter storage as a key. Keys
 * are declared centrally: string literals scattered through the code
 * inevitably lead to collisions and to "lost" records that nobody
 * reads.
 */
export type StorageKey = Brand<string, 'StorageKey'>

/**
 * Logical namespace inside storage.
 *
 * In IndexedDB terms — an object store. The split is required:
 * clearing the balance cache must not touch the key vault, and a
 * transactional write in one namespace must not block a read from
 * another.
 */
export const STORAGE_NAMESPACE = {
  /** Encrypted key vault. The most critical area. */
  Vault: 'vault',
  /** Account metadata. Contains no secrets. */
  Accounts: 'accounts',
  /**
   * Networks of the old format — in the clear.
   *
   * KEPT FOR MIGRATION. Wallets created before networks were
   * encrypted store them here; the repository reads this namespace
   * once and clears it. Writing here is no longer allowed.
   */
  Networks: 'networks',

  /**
   * Networks in encrypted form.
   *
   * A SEPARATE NAMESPACE, NOT THE SAME ONE. Encrypted storage sits
   * on the same database, and if we kept one name, migration would
   * read its own encrypted records as old-format records and corrupt
   * them. Different names make that impossible.
   */
  NetworksEncrypted: 'networks-encrypted',
  /**
   * RPC addresses added by the user.
   *
   * Separate from `Networks` not for neatness. `NetworkRepository.findAll`
   * reads every key in its namespace and parses each as a network
   * config: a stray record next to them would become a corrupted
   * network in the list.
   *
   * Contents are encrypted: an own-node URL usually carries an
   * operator-account key.
   */
  RpcEndpoints: 'rpc-endpoints',
  /** Tracked tokens. */
  Tokens: 'tokens',
  /** Transaction history. */
  Transactions: 'transactions',
  /** Balance cache. May be cleared without losing data. */
  BalanceCache: 'balance-cache',

  /**
   * Connections to apps (WalletConnect).
   *
   * CONTAINS SECRETS. Session records carry symmetric keys that
   * encrypt exchange with the app through the relay: whoever has
   * them reads the traffic and can impersonate the wallet. So the
   * namespace is encrypted, not open — and deleting the wallet
   * takes the connections with it.
   */
  DappSessions: 'dapp-sessions',
  /** Application settings. */
  Settings: 'settings',
  /**
   * Log of secrets given out.
   *
   * Contains no secrets themselves — only the export kind, the
   * account path, and the time. Needed to detect a dangerous
   * combination of issued artifacts (see `core/security`).
   */
  ExportAudit: 'export-audit',
} as const

export type StorageNamespace = (typeof STORAGE_NAMESPACE)[keyof typeof STORAGE_NAMESPACE]

/**
 * Read and write operations within one transaction.
 *
 * A separate interface from {@link IStorageService} so transactional
 * operations cannot be called outside a transaction, and conversely
 * a nested transaction is impossible by types.
 */
export interface IStorageTransaction {
  get<TValue>(namespace: StorageNamespace, key: StorageKey): Promise<TValue | null>
  set<TValue>(namespace: StorageNamespace, key: StorageKey, value: TValue): Promise<void>
  remove(namespace: StorageNamespace, key: StorageKey): Promise<void>
  keys(namespace: StorageNamespace): Promise<readonly StorageKey[]>
  clear(namespace: StorageNamespace): Promise<void>
}

/**
 * One storage-schema migration step.
 *
 * Migrations are critical for a wallet: the user updates the app
 * holding a single copy of the keys. A failed migration without
 * rollback means loss of funds. So each step runs in a transaction,
 * and a failure rolls it back entirely.
 */
export interface IStorageMigration {
  /** Schema version this step moves to. Starts at 1. */
  readonly version: number

  /** Short description of the change. Lands in the log when it runs. */
  readonly description: string

  /**
   * Transforms the data.
   *
   * The implementation must be idempotent: interrupting the browser
   * mid-upgrade must not re-apply an irreversible change.
   */
  migrate(transaction: IStorageTransaction): Promise<void>
}

/**
 * How reliably storage holds data.
 *
 * WHY THREE STATES, NOT TWO. "Survives a reload" and "the browser
 * promised not to delete" are different statements, and for a wallet
 * the difference is money. The browser may evict site data when
 * space is short, and for a wallet that is loss of the encrypted
 * seed phrase: without a paper copy the funds are gone for good.
 *
 * The owner must know which of the three states their wallet is in,
 * and they decide what to do about it.
 */
export const STORAGE_DURABILITY = {
  /** Data survives a reload; the browser promised not to evict it. */
  Persistent: 'persistent',

  /**
   * Data survives a reload, but the browser may evict it.
   *
   * The usual state until the user has used the site enough:
   * persistent-storage permission is not granted immediately, and
   * in a private window it is not granted at all.
   */
  BestEffort: 'best-effort',

  /** Data does not survive a tab reload. */
  Session: 'session',
} as const

export type StorageDurability = (typeof STORAGE_DURABILITY)[keyof typeof STORAGE_DURABILITY]

/** Occupied-volume info. Needed to warn about a short quota. */
export interface IStorageEstimate {
  /** Bytes used. */
  readonly usage: number
  /** Bytes available under the browser quota. */
  readonly quota: number
}
