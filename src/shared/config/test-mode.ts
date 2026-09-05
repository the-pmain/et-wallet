/**
 * Temporary relaxations for faster testing.
 *
 * THIS FILE IS THE ONLY PLACE THEY ARE TURNED ON AND OFF.
 * The protection code is not deleted: it stays in place and turns back
 * on by flipping one value. Deleting instead of a flag would make
 * restore a memory exercise across three screens, not a one-line edit.
 *
 * WHAT IS GIVEN UP. Each relaxation below removes a protection that
 * the matching screen was written for. None of them may ship in a
 * build used with real funds:
 *
 * - hiding seed-phrase import removes the only recovery path. A
 *   forgotten password then leaves nothing to decrypt storage with,
 *   and the wallet is lost with it.
 *
 * A production build with the flag on is stopped: see
 * `assertTestModeIsDisabledInProduction`.
 */

/**
 * Whether temporary relaxations are on.
 *
 * SET BACK TO `false` BY THE OWNER: seed-phrase sign-in works.
 *
 * Phrase-writing confirmation no longer belongs here — it is off by a
 * permanent decision, see `APP_CONFIG.requiresSeedConfirmation`.
 */
export const IS_TEST_MODE = false

/** Which protections are lifted. Listed explicitly, not implied. */
export const TEST_MODE = {
  /**
   * Hide seed-phrase sign-in.
   *
   * The import screen and its route are unavailable. Wallet recovery
   * is then impossible by any means.
   */
  hideSeedImport: IS_TEST_MODE,
} as const

/**
 * Stops a production build with relaxations enabled.
 *
 * Called from the application entry. The check belongs in production:
 * a forgotten flag is not a hypothetical slip — it is a common way to
 * lose someone else's money.
 */
export function assertTestModeIsDisabledInProduction(): void {
  if (IS_TEST_MODE && import.meta.env.PROD) {
    throw new Error(
      'This build was made with temporary security relaxations (IS_TEST_MODE). ' +
        'Restoring a wallet from a seed phrase is disabled. ' +
        'Set IS_TEST_MODE back to false in src/shared/config/test-mode.ts.',
    )
  }
}
