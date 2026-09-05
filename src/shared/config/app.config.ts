/**
 * Single access point for runtime parameters.
 *
 * Components and services do not read `import.meta.env` directly: that is a
 * hidden bundler dependency that breaks unit tests and blocks reuse outside
 * Vite (for example in an extension service worker).
 */
export const APP_CONFIG = {
  name: 'ETWallet',

  /** Caption next to the mark in the header and sidebar. */
  brandLabel: 'ET WALLET',

  /** Version from package.json, injected at build time. */
  version: __APP_VERSION__,

  /** Development mode: enables diagnostics and dev tools. */
  isDevelopment: import.meta.env.DEV,

  /** Production mode: debug branches must stay off. */
  isProduction: import.meta.env.PROD,

  /**
   * Whether to quiz seed-phrase words after they are shown.
   *
   * DISABLED BY THE OWNER. Lives here, not in `test-mode.ts`: that file
   * holds temporary relaxations for faster testing, and a production
   * build with them enabled does not compile at all. This decision is
   * permanent and is part of the product.
   *
   * WHAT IS GIVEN UP. The quiz was the only place the wallet checked
   * that the phrase was written down rather than skipped. A warning is
   * read with the eyes; a quiz forces paper. Without it a wallet can
   * exist for someone who never wrote the phrase down: losing the
   * device then means losing funds with no one to ask.
   *
   * WHAT STILL STANDS IN THE WAY. The checkbox “I have written the
   * phrase down and understand that without it access cannot be
   * restored” is required even without the quiz: create stays disabled
   * until it is checked.
   *
   * TO RESTORE, CHANGE THIS VALUE. The quiz screen and answer parsing
   * are not deleted and stay covered by tests.
   */
  requiresSeedConfirmation: false,
} as const

export type AppConfig = typeof APP_CONFIG
