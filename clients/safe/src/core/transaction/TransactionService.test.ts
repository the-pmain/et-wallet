import { beforeEach, describe, expect, it } from 'vitest'

import { toAddress } from '@/core/address'
import { SecureStorage } from '@/core/encryption'
import {
  GasEstimationFailedError,
  InsufficientFundsError,
  InsufficientTokenBalanceError,
  NftNotOwnedError,
} from '@/core/errors'
import { EventBus } from '@/core/events'
import {
  BUILT_IN_CHAIN_ID,
  BUILT_IN_NETWORKS,
  DEFAULT_CHAIN_ID,
  NetworkRepository,
  NetworkService,
} from '@/core/network'
import type { IFeeData, ILogEntry, IProvider, ProviderEventMap } from '@/core/provider'
import { MemoryStorageService } from '@/core/storage'
import { TOKEN_STANDARD } from '@/core/token'
import { toWei, type ChainId, type HexString, type TxHash, type Wei } from '@/core/types'
import { FakeClock, FakeProviderFactory, FastEncryptionService, NullLogger } from '@/test/doubles'

import { TransactionRepository } from './TransactionRepository'
import { TransactionService } from './TransactionService'
import { FEE_PRIORITY, TRANSACTION_TYPE, type ISignedTransaction } from './types'

const PASSWORD = 'Korova-7-Luna!'

const CHAIN_ID = BUILT_IN_CHAIN_ID.Ethereum
const SENDER = toAddress('0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed')
const RECIPIENT = toAddress('0xfB6916095ca1df60bB79Ce92cE3Ea74c37c5d359')

/** One ether in the smallest units. */
const ONE_ETHER = 10n ** 18n

class StubProvider implements IProvider {
  readonly chainId = CHAIN_ID
  readonly rpcUrl = 'https://stub.example'
  readonly isActive = true

  balance: bigint = ONE_ETHER * 10n
  nonce = 7
  gasEstimate: bigint | Error = 21_000n
  feeData: IFeeData = {
    baseFeePerGas: 20_000_000_000n,
    maxFeePerGas: 30_000_000_000n,
    maxPriorityFeePerGas: 2_000_000_000n,
    gasPrice: 25_000_000_000n,
  }

  sentRaw: HexString | null = null
  sendError: Error | null = null

  readonly #events = new EventBus<ProviderEventMap>()

  getNonce(): Promise<number> {
    return Promise.resolve(this.nonce)
  }

  /** Bytecode at the address. An ordinary address: these tests do not check for a contract. */
  getCode(): Promise<HexString> {
    return Promise.resolve('0x' as HexString)
  }
  /** Last gas-estimate request. Lets the test see what went to the node. */
  lastEstimateRequest: { readonly to: unknown } | null = null

  estimateGas(request: { readonly to: unknown }): Promise<bigint> {
    this.lastEstimateRequest = request

    return this.gasEstimate instanceof Error
      ? Promise.reject(this.gasEstimate)
      : Promise.resolve(this.gasEstimate)
  }

  getFeeData(): Promise<IFeeData> {
    return Promise.resolve(this.feeData)
  }

  getBalance(): Promise<Wei> {
    return Promise.resolve(toWei(this.balance))
  }

  sendRawTransaction(raw: HexString): Promise<TxHash> {
    if (this.sendError !== null) {
      return Promise.reject(this.sendError)
    }

    this.sentRaw = raw

    return Promise.resolve('0xdeadbeef' as TxHash)
  }

  getTransactionReceipt(): Promise<null> {
    return Promise.resolve(null)
  }

  getBlockNumber(): Promise<bigint> {
    return Promise.resolve(1n)
  }

  getChainId(): Promise<ChainId> {
    return Promise.resolve(CHAIN_ID)
  }

  request<TResult>(): Promise<TResult> {
    return Promise.reject(new Error('not supported'))
  }

  getTransactionCount(): Promise<number> {
    return Promise.resolve(this.nonce)
  }

  /** Contract reply to `call`. Defaults to a token balance. */
  tokenBalance = 1_000_000n

  /** Owner that `ownerOf` will name. */
  nftOwner: string | null = null

  /** Node refusal when reading the token balance. */
  callError: Error | null = null

  call(request: { readonly data?: HexString }): Promise<HexString> {
    if (this.callError !== null) {
      return Promise.reject(this.callError)
    }

    /* `ownerOf` replies with an address; no owner is a revert,
       as with a burned item. */
    if (this.nftOwner !== null && (request.data ?? '').startsWith('0x6352211e')) {
      return Promise.resolve(
        `0x${this.nftOwner.slice(2).toLowerCase().padStart(64, '0')}` as HexString,
      )
    }

    return Promise.resolve(`0x${this.tokenBalance.toString(16).padStart(64, '0')}` as HexString)
  }

  getLogs(): Promise<readonly ILogEntry[]> {
    return Promise.resolve([])
  }

  destroy(): void {
    /* The stand-in has nothing to release. */
  }

  on = this.#events.on.bind(this.#events)
  once = this.#events.once.bind(this.#events)
  off = this.#events.off.bind(this.#events)
}

let node: StubProvider
let service: TransactionService
let repository: TransactionRepository

const request = { chainId: CHAIN_ID, from: SENDER, to: RECIPIENT, value: toWei(ONE_ETHER) }

beforeEach(async () => {
  node = new StubProvider()

  const storage = new MemoryStorageService()
  const secure = new SecureStorage(storage, new FastEncryptionService())

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

  repository = new TransactionRepository(secure)
  service = new TransactionService({
    resolver: { get: () => Promise.resolve(node) },
    networks,
    repository,
    clock: new FakeClock(1_700_000_000_000),
    logger,
  })
})

describe('TransactionService.prepare', () => {
  it('takes a nonce that includes the mempool', async () => {
    /* A value that ignored pending transactions would make the new
       one replace the previous instead of queuing behind it. */
    expect((await service.prepare(request)).nonce).toBe(7)
  })

  it('puts the network chainId into the signed data', async () => {
    /* Without chainId the signature is valid on every EVM network
       at once and can be replayed on mainnet (EIP-155). */
    expect((await service.prepare(request)).chainId).toBe(CHAIN_ID)
  })

  it('adds a buffer to the gas-limit estimate', async () => {
    node.gasEstimate = 21_000n

    /* The estimate is made on the current block, and the transaction
       lands in the next: the exact limit may not be enough, and unused
       gas is refunded. */
    expect((await service.prepare(request)).gasLimit).toBe(25_200n)
  })

  it('builds an EIP-1559 transaction on a supporting network', async () => {
    const transaction = await service.prepare(request)

    expect(transaction.type).toBe(TRANSACTION_TYPE.Eip1559)
    expect(transaction.maxFeePerGas).toBe(30_000_000_000n)
    expect(transaction.gasPrice).toBeNull()
  })

  it('builds a legacy transaction when the node reports no base fee', async () => {
    node.feeData = { ...node.feeData, maxFeePerGas: null, maxPriorityFeePerGas: null }

    const transaction = await service.prepare(request)

    /* The network claims EIP-1559, but the node gave no data: a type-2
       transaction would be rejected. */
    expect(transaction.type).toBe(TRANSACTION_TYPE.Legacy)
    expect(transaction.gasPrice).toBe(25_000_000_000n)
  })

  it('does not send a transaction that will revert', async () => {
    node.gasEstimate = new GasEstimationFailedError('the call will revert')

    /* A revert charges gas without performing the operation. Assigning
       a limit arbitrarily here would burn funds for certain. */
    await expect(service.prepare(request)).rejects.toBeInstanceOf(GasEstimationFailedError)
  })

  it('rejects a transfer that cannot cover the amount plus the fee', async () => {
    node.balance = ONE_ETHER

    /* The amount equals the balance, but there is nothing left for the
       fee. The check uses the fee cap — that is what the node checks. */
    await expect(service.prepare(request)).rejects.toBeInstanceOf(InsufficientFundsError)
  })

  it('allows a transfer when funds cover the amount plus the fee', async () => {
    node.balance = ONE_ETHER * 2n

    await expect(service.prepare(request)).resolves.toBeDefined()
  })

  it('respects an explicit nonce and gas limit', async () => {
    const transaction = await service.prepare({ ...request, nonce: 42, gasLimit: 100_000n })

    expect(transaction.nonce).toBe(42)
    expect(transaction.gasLimit).toBe(100_000n)
  })
})

describe('TransactionService.estimateFees', () => {
  it('offers three urgency levels', async () => {
    const fees = await service.estimateFees(await service.prepare(request))

    expect(fees.map((fee) => fee.priority)).toEqual([
      FEE_PRIORITY.Low,
      FEE_PRIORITY.Medium,
      FEE_PRIORITY.High,
    ])
  })

  it('raises the priority tip as urgency grows', async () => {
    const fees = await service.estimateFees(await service.prepare(request))
    const tips = fees.map((fee) => fee.maxPriorityFeePerGas ?? 0n)

    expect(tips[0]).toBeLessThan(tips[1] ?? 0n)
    expect(tips[1]).toBeLessThan(tips[2] ?? 0n)
  })

  it('does not promise a confirmation time', async () => {
    const fees = await service.estimateFees(await service.prepare(request))

    /* Time depends on network load at the moment of inclusion.
       A made-up number would be a promise the wallet cannot keep. */
    expect(fees.every((fee) => fee.estimatedSeconds === null)).toBe(true)
  })

  it('computes the upper bound of the charge', async () => {
    const transaction = await service.prepare(request)
    const [fee] = await service.estimateFees(transaction)

    expect(fee?.maxCost).toBe(transaction.gasLimit * (fee?.maxFeePerGas ?? 0n))
  })
})

describe('TransactionService.send', () => {
  const signed = (raw: string): ISignedTransaction => ({
    raw: raw as HexString,
    hash: '0xdeadbeef' as TxHash,
    transaction: {
      type: TRANSACTION_TYPE.Eip1559,
      chainId: CHAIN_ID,
      from: SENDER,
      to: RECIPIENT,
      value: toWei(ONE_ETHER),
      data: '0x' as HexString,
      nonce: 7,
      gasLimit: 21_000n,
      maxFeePerGas: 30_000_000_000n,
      maxPriorityFeePerGas: 2_000_000_000n,
      gasPrice: null,
    },
  })

  it('publishes the signed bytes unchanged', async () => {
    await service.send(signed('0xsigned'))

    expect(node.sentRaw).toBe('0xsigned')
  })

  it('returns the transaction hash', async () => {
    expect(await service.send(signed('0xsigned'))).toBe('0xdeadbeef')
  })

  it('writes a history record after a successful publish', async () => {
    await service.send(signed('0xsigned'))

    const record = await repository.findByHash('0xdeadbeef' as TxHash)

    expect(record?.status).toBe('pending')
    expect(record?.value).toBe(ONE_ETHER)
  })

  it('does not save a record if publish fails', async () => {
    node.sendError = new Error('the node did not respond')

    await expect(service.send(signed('0xsigned'))).rejects.toThrow()

    /* A record of a transaction that is not on the network would make
       the user wait for confirmation of something never sent. */
    expect(await repository.findByHash('0xdeadbeef' as TxHash)).toBeNull()
  })

  it('announces the publish with an event', async () => {
    let submitted = 0
    service.on('transaction:submitted', () => {
      submitted += 1
    })

    await service.send(signed('0xsigned'))

    expect(submitted).toBe(1)
  })
})

describe('Token transfer', () => {
  const TOKEN = toAddress('0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48')

  const tokenRequest = {
    chainId: CHAIN_ID,
    from: SENDER,
    token: TOKEN,
    to: RECIPIENT,
    amount: 250_000n,
  }

  it('the transaction is addressed to the contract, not the recipient', async () => {
    /* A token transfer is a contract call. Putting a person's address
       in `to` would send them native currency instead of the token. */
    const transaction = await service.prepareTokenTransfer(tokenRequest)

    expect(transaction.to).toBe(TOKEN)
  })

  it('no native currency is transferred', async () => {
    expect((await service.prepareTokenTransfer(tokenRequest)).value).toBe(0n)
  })

  it('the recipient and amount sit in the call data', async () => {
    const transaction = await service.prepareTokenTransfer(tokenRequest)

    expect(transaction.data).toBe(
      '0xa9059cbb' +
        '000000000000000000000000fb6916095ca1df60bb79ce92ce3ea74c37c5d359' +
        '000000000000000000000000000000000000000000000000000000000003d090',
    )
  })

  it('the gas limit is estimated by the node, not assigned', async () => {
    /* A contract call costs more than a simple transfer, and how much
       depends on the contract: a token with rebates or a blacklist
       burns more. A guessed limit leads to a revert that still
       charges gas. */
    node.gasEstimate = 65_000n

    expect((await service.prepareTokenTransfer(tokenRequest)).gasLimit).toBeGreaterThan(65_000n)
  })

  it('refuses when the token balance is below the amount', async () => {
    /* Otherwise the contract would revert the call, gas would be
       charged, and no transfer would happen. A node gas-estimate
       refusal does not name the reason. */
    node.tokenBalance = 100n

    await expect(service.prepareTokenTransfer(tokenRequest)).rejects.toThrow(
      InsufficientTokenBalanceError,
    )
  })

  it('names the required and available amounts', async () => {
    node.tokenBalance = 100n

    await expect(service.prepareTokenTransfer(tokenRequest)).rejects.toMatchObject({
      required: 250_000n,
      available: 100n,
    })
  })

  it('does not treat a contract outage as a zero balance', async () => {
    /* "The check failed" and "there are no tokens" are different
       claims. Refusing on a missing value would block a transfer
       just because the node is down. */
    node.tokenBalance = 0n
    node.callError = new Error('the node did not respond')

    await expect(service.prepareTokenTransfer(tokenRequest)).resolves.toMatchObject({ to: TOKEN })
  })

  it('still catches a native-currency shortage for the fee', async () => {
    /* There are enough tokens, but nothing to pay gas with. */
    node.balance = 1n

    await expect(service.prepareTokenTransfer(tokenRequest)).rejects.toThrow(InsufficientFundsError)
  })
})

describe('Collectible transfer', () => {
  const COLLECTION = toAddress('0xBC4CA0EdA7647A8aB7C2061c2E118A18a936f13D')

  const nftRequest = {
    chainId: CHAIN_ID,
    from: SENDER,
    contract: COLLECTION,
    to: RECIPIENT,
    tokenId: 777n,
    standard: TOKEN_STANDARD.Erc721,
  }

  it('the transaction is addressed to the collection contract', async () => {
    node.nftOwner = SENDER

    expect((await service.prepareNftTransfer(nftRequest)).to).toBe(COLLECTION)
  })

  it('no native currency is transferred', async () => {
    node.nftOwner = SENDER

    expect((await service.prepareNftTransfer(nftRequest)).value).toBe(0n)
  })

  it('calls the safe transfer', async () => {
    /* Plain `transferFrom` will also send the item to a contract that
       cannot receive it: from there it never comes back. */
    node.nftOwner = SENDER

    expect((await service.prepareNftTransfer(nftRequest)).data.startsWith('0x42842e0e')).toBe(true)
  })

  it('the sender is included in the call data', async () => {
    /* `safeTransferFrom` takes it as an explicit argument: the
       contract also allows a transfer by an approved operator. */
    node.nftOwner = SENDER

    const data = (await service.prepareNftTransfer(nftRequest)).data

    expect(data.slice(10, 74)).toContain(SENDER.slice(2).toLowerCase())
  })

  it('refuses when the item belongs to another address', async () => {
    /* The contract would reject the call itself, but gas would still
       be charged and the reason would stay unclear. */
    node.nftOwner = RECIPIENT

    await expect(service.prepareNftTransfer(nftRequest)).rejects.toThrow(NftNotOwnedError)
  })

  it('ERC-1155 is transferred with an amount', async () => {
    node.tokenBalance = 5n

    const transaction = await service.prepareNftTransfer({
      ...nftRequest,
      standard: TOKEN_STANDARD.Erc1155,
      amount: 3n,
    })

    expect(transaction.data.startsWith('0xf242432a')).toBe(true)
    expect(BigInt(`0x${transaction.data.slice(202, 266)}`)).toBe(3n)
  })

  it('ERC-1155 refuses when fewer copies are held', async () => {
    node.tokenBalance = 1n

    await expect(
      service.prepareNftTransfer({
        ...nftRequest,
        standard: TOKEN_STANDARD.Erc1155,
        amount: 3n,
      }),
    ).rejects.toThrow(NftNotOwnedError)
  })

  it('a contract outage does not block the transfer', async () => {
    /* "The check failed" and "the item is not yours" are different
       claims. Refusing on a silent node would lock the owner out of
       their own property. */
    node.callError = new Error('the node did not respond')

    await expect(service.prepareNftTransfer(nftRequest)).resolves.toMatchObject({
      to: COLLECTION,
    })
  })
})

describe('Contract deployment', () => {
  /* Call data with no recipient: that is what a deployment looks like. */
  const BYTECODE = '0x60806040' as HexString

  const deployment = {
    chainId: CHAIN_ID,
    from: SENDER,
    to: null,
    value: toWei(0n),
    data: BYTECODE,
  }

  it('the recipient stays empty', async () => {
    /* Filling in the sender address would turn a deployment into a
       transfer to oneself: the user would approve one thing and
       sign another. */
    expect((await service.prepare(deployment)).to).toBeNull()
  })

  it('the node is asked without a recipient', async () => {
    /* The missing `to` field is what tells the node a deployment is
       being estimated. With a filled-in address it would estimate a
       simple transfer, and the assigned limit would fall short: a
       revert that still charges gas. */
    await service.prepare(deployment)

    expect(node.lastEstimateRequest?.to).toBeNull()
  })

  it('the call data is kept in full', async () => {
    expect((await service.prepare(deployment)).data).toBe(BYTECODE)
  })
})

describe('Approval revocation', () => {
  const TOKEN = toAddress('0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48')
  const SPENDER = toAddress('0xfB6916095ca1df60bB79Ce92cE3Ea74c37c5d359')

  const revokeRequest = {
    chainId: CHAIN_ID,
    from: SENDER,
    contract: TOKEN,
    spender: SPENDER,
    standard: TOKEN_STANDARD.Erc20,
  }

  it('the transaction is addressed to the contract that holds the approval', async () => {
    expect((await service.prepareRevokeApproval(revokeRequest)).to).toBe(TOKEN)
  })

  it('for a token, revocation writes zero', async () => {
    /* The standard has no separate "revoke" function: the
       allowance is overwritten. */
    const transaction = await service.prepareRevokeApproval(revokeRequest)

    expect(transaction.data.startsWith('0x095ea7b3')).toBe(true)
    expect(BigInt(`0x${transaction.data.slice(74)}`)).toBe(0n)
  })

  it('for a collection, revocation clears the flag', async () => {
    const transaction = await service.prepareRevokeApproval({
      ...revokeRequest,
      standard: TOKEN_STANDARD.Erc721,
    })

    expect(transaction.data.startsWith('0xa22cb465')).toBe(true)
    expect(BigInt(`0x${transaction.data.slice(74)}`)).toBe(0n)
  })

  it('no native currency is transferred', async () => {
    expect((await service.prepareRevokeApproval(revokeRequest)).value).toBe(0n)
  })

  it('the approval recipient is included in the call data', async () => {
    const transaction = await service.prepareRevokeApproval(revokeRequest)

    expect(transaction.data.slice(10, 74)).toContain(SPENDER.slice(2).toLowerCase())
  })
})
