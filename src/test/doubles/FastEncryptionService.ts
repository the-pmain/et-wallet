import { EncryptionService, type IKdfParams } from '@/core'

/**
 * PBKDF2 iteration count in tests.
 *
 * The production value is 600 000, and one key derivation takes
 * hundreds of milliseconds. A suite of fifty tests would run for
 * minutes.
 */
export const TEST_KDF_ITERATIONS = 1_000

/**
 * Encryption with a reduced iteration count. TESTS ONLY.
 *
 * Implemented by inheritance, not a constructor parameter, on
 * purpose: production code gets no way to weaken the KDF. The
 * only way to lower strength is to write a subclass, which cannot
 * happen by accident or inattention.
 *
 * Separate tests check that the base class kept production
 * parameters.
 */
export class FastEncryptionService extends EncryptionService {
  override createKdfParams(): IKdfParams {
    return { ...super.createKdfParams(), iterations: TEST_KDF_ITERATIONS }
  }
}
