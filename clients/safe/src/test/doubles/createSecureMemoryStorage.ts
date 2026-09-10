import { SecureStorage } from '@/core/encryption'
import { MemoryStorageService } from '@/core/storage'

import { FastEncryptionService } from './FastEncryptionService'

/**
 * Ready encrypted store on top of memory.
 *
 * WHY A SEPARATE HELPER. Checks that need any repository on top of
 * encryption repeated the same four lines: create memory, wrap in
 * `SecureStorage`, inject fast encryption, remember `initialize`.
 * Skipping that last step yields “store is locked” in the middle
 * of a check that is not about locking.
 *
 * ENCRYPTION IS FAST. Real 600 000 PBKDF2 iterations in every
 * check would turn the run into minutes; strength is checked
 * where it is the subject of the check.
 */
/** Test-store password. One for every check: it is not a secret. */
const PASSWORD = 'Korova-7-Luna!'

export async function createSecureMemoryStorage(
  storage: MemoryStorageService = new MemoryStorageService(),
): Promise<SecureStorage> {
  const secure = new SecureStorage(storage, new FastEncryptionService())

  /* The same memory may already carry a header — for example when
     a check rebuilds services on the previous store to prove data
     survived a restart. Re-initialize would refuse in that case,
     and what is needed is access. */
  if (await secure.isInitialized()) {
    await secure.unlock(PASSWORD)
  } else {
    await secure.initialize(PASSWORD)
  }

  return secure
}
