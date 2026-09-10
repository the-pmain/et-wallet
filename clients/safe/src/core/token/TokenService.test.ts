import { beforeEach, describe, expect, it } from 'vitest'

import { toAddress } from '@/core/address'
import { SecureStorage } from '@/core/encryption'
import {
  InvalidTokenContractError,
  NotInitializedError,
  TokenNotFoundError,
  UnsupportedTokenStandardError,
} from '@/core/errors'
import { EventBus } from '@/core/events'
import {
  BUILT_IN_CHAIN_ID,
  BUILT_IN_NETWORKS,
  DEFAULT_CHAIN_ID,
  NetworkRepository,
  NetworkService,
  type INetworkConfig,
} from '@/core/network'
import type { ICallRequest, ILogEntry, IProvider, ProviderEventMap } from '@/core/provider'
import { MemoryStorageService } from '@/core/storage'
import type { ChainId, HexString, Wei } from '@/core/types'
import {
  FakeClock,
  FakeProviderFactory,
  FastEncryptionService,
  NullLogger,
  createSecureMemoryStorage,
} from '@/test/doubles'

import { BALANCE_OF_SELECTOR, DECIMALS_SELECTOR, NAME_SELECTOR, SYMBOL_SELECTOR } from './erc20'
import { TokenRepository } from './TokenRepository'
import { TokenService } from './TokenService'
import { TOKEN_STANDARD } from './types'

const PASSWORD = 'Korova-7-Luna!'

const CHAIN_ID = BUILT_IN_CHAIN_ID.Ethereum
const OWNER = toAddress('0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed')
const TOKEN = toAddress('0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48')

function word(value: string): string {
  return value.padStart(64, '0')
}

function encodeText(text: string): HexString {
  const bytes = [...new TextEncoder().encode(text)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')

  return `0x${word('20')}${word((bytes.length / 2).toString(16))}${bytes.padEnd(64, '0')}` as HexString
}

/** Contract replies to calls. `null` means a refusal. */
interface IContractResponses {
  decimals?: string | null
  symbol?: HexString | null
  name?: HexString | null
  balance?: string | null
}

class StubProvider implements IProvider {
  readonly chainId = CHAIN_ID
  readonly rpcUrl = 'https://stub.example'
  readonly isActive = true

  responses: IContractResponses = {}
  logs: readonly ILogEntry[] = []
  calls: ICallRequest[] = []

  readonly #events = new EventBus<ProviderEventMap>()

  call(request: ICallRequest): Promise<HexString> {
    this.calls.push(request)

    const data = request.data ?? ''
    const selector = data.slice(2, 10)
    const answer = this.#answer(selector)

    return answer === null || answer === undefined
      ? Promise.reject(new Error('contract refused'))
      : Promise.resolve(answer)
  }

  #answer(selector: string): HexString | null | undefined {
    if (selector === DECIMALS_SELECTOR) {
      const value = this.responses.decimals

      return value === null || value === undefined ? value : (`0x${word(value)}` as HexString)
    }

    if (selector === SYMBOL_SELECTOR) {
      return this.responses.symbol
    }

    if (selector === NAME_SELECTOR) {
      return this.responses.name
    }

    if (selector === BALANCE_OF_SELECTOR) {
      const value = this.responses.balance

      return value === null || value === undefined ? value : (`0x${word(value)}` as HexString)
    }

    return null
  }

  getLogs(): Promise<readonly ILogEntry[]> {
    return Promise.resolve(this.logs)
  }

  getBlockNumber(): Promise<bigint> {
    return Promise.resolve(20_000n)
  }

  getChainId(): Promise<ChainId> {
    return Promise.resolve(CHAIN_ID)
  }

  request<TResult>(): Promise<TResult> {
    return Promise.reject(new Error('not supported'))
  }

  getBalance(): Promise<Wei> {
    return Promise.resolve(0n as Wei)
  }

  getTransactionCount(): Promise<number> {
    return Promise.resolve(0)
  }

  getNonce(): Promise<number> {
    return Promise.resolve(0)
  }

  /** Bytecode at the address. An ordinary address: these tests do not check for a contract. */
  getCode(): Promise<HexString> {
    return Promise.resolve('0x' as HexString)
  }
  estimateGas(): Promise<bigint> {
    return Promise.resolve(21_000n)
  }

  getFeeData(): Promise<never> {
    return Promise.reject(new Error('not supported'))
  }

  sendRawTransaction(): Promise<never> {
    return Promise.reject(new Error('not supported'))
  }

  getTransactionReceipt(): Promise<null> {
    return Promise.resolve(null)
  }

  destroy(): void {
    /* The stand-in has nothing to release. */
  }

  on = this.#events.on.bind(this.#events)
  once = this.#events.once.bind(this.#events)
  off = this.#events.off.bind(this.#events)
}

let node: StubProvider
let service: TokenService
let secure: SecureStorage

async function createService(): Promise<TokenService> {
  const storage = new MemoryStorageService()

  secure = new SecureStorage(storage, new FastEncryptionService())
  await secure.initialize(PASSWORD)

  const logger = new NullLogger()
  const networks = new NetworkService({
    repository: new NetworkRepository(secure),
    providerFactory: new FakeProviderFactory(),
    logger,
    builtInNetworks: BUILT_IN_NETWORKS,
    defaultChainId: DEFAULT_CHAIN_ID,
  })

  await networks.init()

  return new TokenService({
    repository: new TokenRepository(secure),
    resolver: { get: (_network: INetworkConfig) => Promise.resolve(node) },
    networks,
    clock: new FakeClock(1_700_000_000_000),
    logger,
  })
}

beforeEach(async () => {
  node = new StubProvider()
  node.responses = {
    decimals: '6',
    symbol: encodeText('USDC'),
    name: encodeText('USD Coin'),
    balance: '1e8480',
  }

  service = await createService()
  await service.init()
})

describe('TokenService: list', () => {
  it('always contains the native currency first', () => {
    const [first] = service.list(CHAIN_ID)

    expect(first?.address).toBeNull()
    expect(first?.standard).toBe(TOKEN_STANDARD.Native)
    expect(first?.symbol).toBe('ETH')
  })

  it('does not mark the native currency as custom', () => {
    /* It is part of the network config, not a user addition. */
    expect(service.list(CHAIN_ID)[0]?.isCustom).toBe(false)
  })

  it('refuses before initialisation', async () => {
    const fresh = await createService()

    expect(() => fresh.list(CHAIN_ID)).toThrow(NotInitializedError)
  })

  it('returns an empty list for an unknown network', () => {
    expect(service.list(999_999n as ChainId)).toHaveLength(0)
  })
})

describe('TokenService: reading metadata', () => {
  it('reads the symbol, name and decimals from the contract', async () => {
    const metadata = await service.fetchMetadata(CHAIN_ID, TOKEN)

    expect(metadata.symbol).toBe('USDC')
    expect(metadata.name).toBe('USD Coin')
    expect(metadata.decimals).toBe(6)
  })

  it('rejects a contract that does not report decimals', async () => {
    node.responses.decimals = null

    /* Without decimals any shown amount is made up. */
    await expect(service.fetchMetadata(CHAIN_ID, TOKEN)).rejects.toBeInstanceOf(
      InvalidTokenContractError,
    )
  })

  it('rejects an illegal decimals value', async () => {
    node.responses.decimals = 'ff'

    await expect(service.fetchMetadata(CHAIN_ID, TOKEN)).rejects.toBeInstanceOf(
      InvalidTokenContractError,
    )
  })

  it('fills in a truncated address when the symbol is missing', async () => {
    node.responses.symbol = null
    node.responses.name = null

    const metadata = await service.fetchMetadata(CHAIN_ID, TOKEN)

    /* Symbol and name are optional in the standard: refusing to add
       such a token would be excessive, and a truncated address is
       truthful. */
    expect(metadata.symbol).toContain('0xA0b8')
    expect(metadata.name).toContain('0xA0b8')
  })

  it('reads an old token symbol as bytes32', async () => {
    const bytes = [...new TextEncoder().encode('MKR')]
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('')

    node.responses.symbol = `0x${bytes.padEnd(64, '0')}` as HexString

    expect((await service.fetchMetadata(CHAIN_ID, TOKEN)).symbol).toBe('MKR')
  })
})

describe('TokenService: adding', () => {
  it('adds a token with metadata from the contract', async () => {
    const token = await service.add({ chainId: CHAIN_ID, address: TOKEN })

    expect(token.symbol).toBe('USDC')
    expect(token.decimals).toBe(6)
    expect(service.list(CHAIN_ID)).toHaveLength(2)
  })

  it('marks an added token as custom', async () => {
    /* Anyone can issue a token with a known project's ticker. There
       is no built-in verified list: an address written from memory
       would risk marking a fake as genuine. */
    expect((await service.add({ chainId: CHAIN_ID, address: TOKEN })).isCustom).toBe(true)
  })

  it('rejects a decimals mismatch with the contract', async () => {
    /* A six-decimal token recorded as eighteen-decimal would show
       one millionth of the real balance. */
    await expect(
      service.add({ chainId: CHAIN_ID, address: TOKEN, decimals: 18 }),
    ).rejects.toBeInstanceOf(InvalidTokenContractError)
  })

  it('accepts matching decimals', async () => {
    await expect(
      service.add({ chainId: CHAIN_ID, address: TOKEN, decimals: 6 }),
    ).resolves.toBeDefined()
  })

  it('allows the ticker to be overridden', async () => {
    /* The symbol is a label on screen, not arithmetic: the user may
       tell a fake from the real one with their own mark. */
    const token = await service.add({ chainId: CHAIN_ID, address: TOKEN, symbol: 'USDC (fake?)' })

    expect(token.symbol).toBe('USDC (fake?)')
    expect(token.decimals).toBe(6)
  })

  it('rejects a value that is not an address', async () => {
    await expect(
      service.add({ chainId: CHAIN_ID, address: 'not-an-address' as typeof TOKEN }),
    ).rejects.toBeInstanceOf(InvalidTokenContractError)
  })

  it('rejects an unsupported standard', async () => {
    await expect(
      service.add({ chainId: CHAIN_ID, address: TOKEN, standard: TOKEN_STANDARD.Erc721 }),
    ).rejects.toBeInstanceOf(UnsupportedTokenStandardError)
  })

  it('survives a session restart', async () => {
    await service.add({ chainId: CHAIN_ID, address: TOKEN })

    const restored = await createServiceWith(secure)
    await restored.init()

    expect(restored.list(CHAIN_ID)).toHaveLength(2)
  })

  it('emits a list-changed event', async () => {
    let changed = 0
    service.on('token:listChanged', () => {
      changed += 1
    })

    await service.add({ chainId: CHAIN_ID, address: TOKEN })

    expect(changed).toBe(1)
  })
})

describe('TokenService: removal', () => {
  it('removes the token from the list', async () => {
    await service.add({ chainId: CHAIN_ID, address: TOKEN })
    await service.remove({ chainId: CHAIN_ID, address: TOKEN })

    expect(service.list(CHAIN_ID)).toHaveLength(1)
  })

  it('does not allow the native currency to be removed', async () => {
    /* Its absence from the list would mean the network balance is
       unknown. */
    await expect(service.remove({ chainId: CHAIN_ID, address: null })).rejects.toBeInstanceOf(
      UnsupportedTokenStandardError,
    )
  })

  it('refuses on an unknown token', async () => {
    await expect(service.remove({ chainId: CHAIN_ID, address: TOKEN })).rejects.toBeInstanceOf(
      TokenNotFoundError,
    )
  })
})

describe('TokenService: balance', () => {
  it('reads the token balance', async () => {
    const balance = await service.getBalance({ chainId: CHAIN_ID, address: TOKEN }, OWNER)

    expect(balance).toBe(0x1e8480n)
  })

  it('passes the owner address into the call', async () => {
    await service.getBalance({ chainId: CHAIN_ID, address: TOKEN }, OWNER)

    const call = node.calls.find((item) => (item.data ?? '').includes(BALANCE_OF_SELECTOR))

    expect(call?.data).toContain(OWNER.slice(2).toLowerCase())
  })

  it('refuses on the native currency', async () => {
    await expect(
      service.getBalance({ chainId: CHAIN_ID, address: null }, OWNER),
    ).rejects.toBeInstanceOf(UnsupportedTokenStandardError)
  })

  it('forwards a contract refusal to the caller', async () => {
    node.responses.balance = null

    /* Zero instead of a refusal would claim "there are no funds". */
    await expect(
      service.getBalance({ chainId: CHAIN_ID, address: TOKEN }, OWNER),
    ).rejects.toBeInstanceOf(InvalidTokenContractError)
  })
})

/** Rebuilds the service over the same secure storage. */
async function createServiceWith(storage: SecureStorage): Promise<TokenService> {
  const logger = new NullLogger()
  const networks = new NetworkService({
    repository: new NetworkRepository(await createSecureMemoryStorage()),
    providerFactory: new FakeProviderFactory(),
    logger,
    builtInNetworks: BUILT_IN_NETWORKS,
    defaultChainId: DEFAULT_CHAIN_ID,
  })

  await networks.init()

  return new TokenService({
    repository: new TokenRepository(storage),
    resolver: { get: () => Promise.resolve(node) },
    networks,
    clock: new FakeClock(1_700_000_000_000),
    logger,
  })
}

describe('Verified contracts', () => {
  /* `TOKEN` is the USDC address on Ethereum; it is in the built-in
     list. The stand-in replies with the same symbol and decimals
     that the list records. */
  const UNKNOWN = toAddress('0x1111111111111111111111111111111111111111')

  it('a token from the list is marked as verified', async () => {
    expect((await service.add({ chainId: CHAIN_ID, address: TOKEN })).isVerified).toBe(true)
  })

  it('the flags are independent: added by hand and still verified', async () => {
    /* "Added by hand" says how the token entered the list;
       "verified" says whether the address is known. */
    const token = await service.add({ chainId: CHAIN_ID, address: TOKEN })

    expect(token.isCustom).toBe(true)
    expect(token.isVerified).toBe(true)
  })

  it('an unknown contract is not treated as verified', async () => {
    /* This is not an accusation of a fake: the list is incomplete
       by design.

       Consent is required here because the node stand-in answers
       every address with the symbol `USDC`: a contract at a foreign
       address that uses a verified token's name is exactly the case
       the check was written for. */
    const token = await service.add({
      chainId: CHAIN_ID,
      address: UNKNOWN,
      allowImpersonation: true,
    })

    expect(token.isVerified).toBe(false)
  })

  it('a mismatch with the contract clears the mark', async () => {
    /* A contract with an upgradeable implementation may change its
       symbol, and the list in the code may be stale. Marking such a
       record as verified would vouch for something that changed
       without our knowledge. */
    node.responses.symbol = encodeText('USDX')

    expect((await service.add({ chainId: CHAIN_ID, address: TOKEN })).isVerified).toBe(false)
  })

  it('the native currency is always verified', () => {
    /* It is part of the network config, not a user addition. */
    const native = service.list(CHAIN_ID)[0]

    expect(native?.address).toBeNull()
    expect(native?.isVerified).toBe(true)
  })
})
