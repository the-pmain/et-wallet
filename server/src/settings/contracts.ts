/**
 * Encrypted-settings storage.
 *
 * WHAT IS STORED. An opaque string from the client. The service does
 * not parse it, does not inspect it, and has no code that can decrypt
 * it. The key is derived on the device and never leaves.
 *
 * THE SYNC ID IS A BEARER KEY. It is random, generated on the device,
 * and derived from neither the seed phrase nor the address: an
 * "id — address" link would turn the service into an
 * "identity — portfolio" registry. Whoever knows the id can read the
 * ciphertext (useless without the key) and overwrite it. So the id
 * must be long and random, not convenient.
 *
 * SYNC IS A MIRROR, NOT THE SOURCE OF TRUTH. Settings live on the
 * device; the service only helps copy them to a second one. Losing
 * a record here must not mean the user lost their settings.
 */

export interface ISettingsRecord {
  readonly ciphertext: string

  /** Record revision. Grows on every successful write. */
  readonly revision: number

  readonly updatedAt: Date
}

export interface ISettingsRepository {
  get(syncId: string): Promise<ISettingsRecord | null>

  /**
   * Writes settings.
   *
   * @param expectedRevision Revision the client believes is current.
   *        `0` means "no record yet". A mismatch is a refusal: two
   *        devices writing at once would otherwise silently overwrite
   *        each other.
   * @throws ConflictError on a revision mismatch.
   */
  put(syncId: string, ciphertext: string, expectedRevision: number): Promise<ISettingsRecord>

  /** Removes the record. Deleting a missing record again is not an error. */
  remove(syncId: string): Promise<void>
}
