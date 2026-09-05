import type {
  IStorageEstimate,
  IStorageTransaction,
  StorageDurability,
  StorageKey,
  StorageNamespace,
} from './types'

/**
 * Persistent application storage.
 *
 * The abstraction deliberately does not mention IndexedDB. The
 * implementation is substituted: in the web app it is IndexedDB, in
 * a manifest v3 extension — `chrome.storage`, in tests — an
 * in-memory implementation. The domain does not depend on the choice.
 *
 * Why not localStorage (the rule was fixed at stage 1 as an ESLint
 * ban):
 * - it is synchronous and blocks the main thread;
 * - it stores only strings, so binary secrets would have to be
 *   encoded into uncleared JS strings;
 * - it is visible to any page script and is read on XSS in one line;
 * - it is unavailable in a service-worker manifest v3.
 *
 * What this layer does NOT do: it does not encrypt. Encryption is
 * done by the caller via `IEncryptionService` before write. Otherwise
 * storage would start deciding for itself what counts as a secret,
 * and the responsibility boundary would blur.
 *
 * IMPORTANT about serialization. The domain uses `bigint` for amounts
 * and chainId, and `JSON.stringify` throws on `bigint`. The
 * implementation must apply a codec that keeps `bigint` without
 * losing precision. Casting to `number` is not allowed: it silently
 * corrupts amounts.
 */
export interface IStorageService {
  /** Opens storage and runs unapplied migrations. */
  init(): Promise<void>

  get<TValue>(namespace: StorageNamespace, key: StorageKey): Promise<TValue | null>

  set<TValue>(namespace: StorageNamespace, key: StorageKey, value: TValue): Promise<void>

  remove(namespace: StorageNamespace, key: StorageKey): Promise<void>

  has(namespace: StorageNamespace, key: StorageKey): Promise<boolean>

  keys(namespace: StorageNamespace): Promise<readonly StorageKey[]>

  /** Clears one namespace. */
  clear(namespace: StorageNamespace): Promise<void>

  /**
   * Runs operations atomically.
   *
   * Required where several records form one logical change. Example:
   * adding an account changes both the encrypted key vault and the
   * account list. Writing only one of the two leaves the wallet
   * inconsistent — the account is visible but cannot sign, or the
   * key exists and the account does not.
   *
   * An exception inside `handler` rolls back the whole transaction.
   */
  transaction<TResult>(
    namespaces: readonly StorageNamespace[],
    handler: (transaction: IStorageTransaction) => Promise<TResult>,
  ): Promise<TResult>

  /** Occupied-volume estimate. `null` if the browser provides no data. */
  estimate(): Promise<IStorageEstimate | null>

  /**
   * How reliably storage holds data.
   *
   * The implementation must answer honestly: an inflated estimate
   * means the owner will not learn about the risk of losing the
   * wallet.
   */
  durability(): Promise<StorageDurability>

  /**
   * Completely deletes all application data.
   *
   * Irreversible. The caller must get explicit user confirmation and
   * make sure a seed-phrase backup exists.
   */
  destroy(): Promise<void>
}
