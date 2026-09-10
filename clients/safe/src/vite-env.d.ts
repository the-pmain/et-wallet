/// <reference types="vite/client" />

/**
 * App version inlined at build time via `define` in vite.config.ts.
 * Read only through `APP_CONFIG.version` — direct use is not intended.
 */
declare const __APP_VERSION__: string

/**
 * Build-time environment variables.
 *
 * EVERYTHING DECLARED HERE LANDS IN THE BUNDLE IN PLAIN TEXT.
 * Vite substitutes `VITE_*` values into the code; anyone who opens
 * the page source can see them. Secrets — private keys, mnemonics,
 * keys with signing rights — must never go here.
 */
interface ImportMetaEnv {
  /**
   * Alchemy API key.
   *
   * Public by nature of a client app. Must be restricted to the app
   * domain in the Alchemy dashboard: without that restriction strangers
   * use it and the quota runs out.
   *
   * A missing key is a working state: the wallet uses public nodes
   * from the network config.
   */
  readonly VITE_ALCHEMY_API_KEY?: string

  /**
   * Tenderly credentials for transaction simulation.
   *
   * FIT ONLY FOR CHECKS ON YOUR OWN MACHINE. The access key can spend
   * the project quota and read its simulation history; once it is in
   * a shipped build, anyone who opened the page has it. The wallet
   * accepts the same data through settings, where they live in
   * encrypted storage and belong to one owner — that is the path for
   * shipped builds.
   *
   * Missing data is a working state: the node computes transaction
   * effects with `eth_simulateV1`.
   */
  readonly VITE_TENDERLY_ACCOUNT?: string
  readonly VITE_TENDERLY_PROJECT?: string
  readonly VITE_TENDERLY_ACCESS_KEY?: string

  /**
   * CoinGecko demo-access key.
   *
   * Public like the previous one, and must be restricted to the domain.
   * Grants no signing rights: the service returns rates and signs nothing.
   *
   * A missing key is a working state: contract addresses go out one
   * per request, as free access requires.
   */
  readonly VITE_COINGECKO_API_KEY?: string

  /**
   * WalletConnect (Reown) project id.
   *
   * Public by nature of a client app and grants no signing rights:
   * the relay uses it to account for traffic.
   *
   * Missing is a working state: the connections section opens and
   * explains it is not configured. The rest of the wallet works.
   */
  readonly VITE_WALLETCONNECT_PROJECT_ID?: string

  /**
   * Fastify address (`server/`).
   *
   * Public: a URL, not a secret. The wallet calls `POST /v1/users`.
   * An empty value is the same origin; Vite proxies to port 8080.
   */
  readonly VITE_SERVER_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
