import {
  ALLOWANCE_SELECTOR,
  BALANCE_OF_SELECTOR,
  ChainIdMismatchError,
  ERC1155_BALANCE_OF_SELECTOR,
  DECIMALS_SELECTOR,
  ENS_ADDR_SELECTOR,
  ENS_NAME_SELECTOR,
  ENS_REGISTRY_ADDRESS,
  ENS_RESOLVER_SELECTOR,
  EventBus,
  GasEstimationFailedError,
  IS_APPROVED_FOR_ALL_SELECTOR,
  NAME_SELECTOR,
  OWNER_OF_SELECTOR,
  SYMBOL_SELECTOR,
  ProviderUnavailableError,
  areAddressesEqual,
  chainIdToHex,
  functionSelector,
  namehash,
  reverseNode,
  toAddress,
  type Address,
  type ChainId,
  type HexString,
  type ICallRequest,
  type IProvider,
  type IProviderFactory,
  type IFeeData,
  type ILogEntry,
  type ILogFilter,
  type INetworkConfig,
  type ProviderEventMap,
  type TxHash,
  type Wei,
} from '@/core'

/**
 * Provider double.
 *
 * Answers `eth_chainId` with a preset value. That is what lets a
 * test check the network module's main protection: refuse to add a
 * network if the node serves another chain.
 */
class FakeProvider implements IProvider {
  readonly chainId: ChainId
  readonly rpcUrl = 'https://fake.example.com'
  isActive = true

  readonly #reportedChainId: ChainId

  /* Balance is read through a function, not copied at construction.
     Connections are reused by the pool, and a test that changes
     options after the first request would otherwise not see the
     new value. */
  readonly #readBalance: () => Wei | null
  readonly #readBalancesByAddress: () => readonly {
    readonly address: string
    readonly balance: Wei
  }[]
  readonly #readFeeData: () => IFeeData | null
  readonly #readSendError: () => string | null
  readonly #readLogs: () => readonly ILogEntry[]
  readonly #readLatestBlock: () => bigint
  readonly #readContracts: () => readonly string[]
  readonly #readEnsRecords: () => readonly IFakeEnsRecord[]
  readonly #readTokens: () => readonly IFakeToken[]
  readonly #readCollections: () => IFakeCollections
  readonly #readApprovals: () => IFakeApprovals
  readonly #readLogsError: () => string | null
  readonly #readCallRevert: () => { readonly to: string; readonly reason: string } | null
  readonly #readCallFails: () => boolean
  readonly #events = new EventBus<ProviderEventMap>()

  constructor(
    chainId: ChainId,
    reportedChainId: ChainId,
    readBalance: () => Wei | null,
    readBalancesByAddress: () => readonly { readonly address: string; readonly balance: Wei }[],
    readFeeData: () => IFeeData | null,
    readSendError: () => string | null,
    readLogs: () => readonly ILogEntry[],
    readLatestBlock: () => bigint,
    readContracts: () => readonly string[],
    readEnsRecords: () => readonly IFakeEnsRecord[],
    readTokens: () => readonly IFakeToken[],
    readCollections: () => IFakeCollections,
    readApprovals: () => IFakeApprovals,
    readLogsError: () => string | null,
    readCallRevert: () => { readonly to: string; readonly reason: string } | null,
    readCallFails: () => boolean,
  ) {
    this.chainId = chainId
    this.#reportedChainId = reportedChainId
    this.#readBalance = readBalance
    this.#readBalancesByAddress = readBalancesByAddress
    this.#readFeeData = readFeeData
    this.#readSendError = readSendError
    this.#readLogs = readLogs
    this.#readLatestBlock = readLatestBlock
    this.#readContracts = readContracts
    this.#readEnsRecords = readEnsRecords
    this.#readTokens = readTokens
    this.#readCollections = readCollections
    this.#readApprovals = readApprovals
    this.#readLogsError = readLogsError
    this.#readCallRevert = readCallRevert
    this.#readCallFails = readCallFails
  }

  request<TResult>(request: { readonly method: string }): Promise<TResult> {
    if (request.method === 'eth_chainId') {
      return Promise.resolve(chainIdToHex(this.#reportedChainId) as TResult)
    }

    return Promise.reject(new Error(`Method "${request.method}" is not supported by the double.`))
  }

  getChainId(): Promise<ChainId> {
    return Promise.resolve(this.#reportedChainId)
  }

  getNonce(): Promise<number> {
    return Promise.resolve(0)
  }

  getBlockNumber(): Promise<bigint> {
    return Promise.resolve(this.#readLatestBlock())
  }

  getBalance(address: Address): Promise<Wei> {
    const perAddress = this.#readBalancesByAddress().find((entry) =>
      areAddressesEqual(entry.address, address),
    )

    if (perAddress !== undefined) {
      return Promise.resolve(perAddress.balance)
    }

    const balance = this.#readBalance()

    /* Default refusal is intentional: a test that forgot to set a
       balance must fail, not get a silent zero. */
    return balance === null
      ? Promise.reject(new Error('Balance is not set in the double settings.'))
      : Promise.resolve(balance)
  }

  getTransactionCount(): Promise<number> {
    return Promise.resolve(0)
  }

  /**
   * Contract call.
   *
   * Only the ENS registry and its resolver are supported. Default
   * refusal is intentional: a test expecting a reply from a
   * contract the double does not know must fail, not get an empty
   * string.
   */
  call(request: ICallRequest): Promise<HexString> {
    const approval = answerApprovalCall(request, this.#readApprovals())

    if (approval !== null) {
      return Promise.resolve(approval)
    }

    const collection = answerCollectionCall(request, this.#readCollections())

    if (collection !== null) {
      return collection instanceof Error ? Promise.reject(collection) : Promise.resolve(collection)
    }

    const token = answerTokenCall(request, this.#readTokens())

    if (token !== null) {
      return Promise.resolve(token)
    }

    const answer = answerEnsCall(request, this.#readEnsRecords())

    if (answer !== null) {
      return Promise.resolve(answer)
    }

    if (this.#readCallFails()) {
      return Promise.reject(new Error('the node did not answer'))
    }

    const revert = this.#readCallRevert()

    if (revert !== null && areAddressesEqual(toAddress(revert.to), request.to)) {
      /* A real node answers a revert with an error that carries the
         reason, and parsing that data is what the check exists for. */
      return Promise.reject(
        new GasEstimationFailedError(revert.reason, {
          revertData: encodeErrorString(revert.reason),
        }),
      )
    }

    /* A TRANSFER WITH NO CALL DATA THE NODE EXECUTES AND RETURNS
       EMPTY. A double that refuses here would turn an ordinary
       send into “could not check” in every test at once. */
    if (request.data === undefined || request.data === '0x') {
      return Promise.resolve('0x' as HexString)
    }

    return Promise.reject(new Error('Not supported by the double.'))
  }

  /**
   * Bytecode at an address.
   *
   * By default the address is treated as an EOA. A test that
   * checks the warning about sending to a contract sets
   * `contractAddresses` explicitly: a silent “everything is a
   * contract” would hide a missing check.
   */
  getCode(address: Address): Promise<HexString> {
    const contracts = this.#readContracts().map((item) => item.toLowerCase())

    return Promise.resolve(
      (contracts.includes(address.toLowerCase()) ? '0x60006000' : '0x') as HexString,
    )
  }

  estimateGas(): Promise<bigint> {
    return Promise.resolve(21000n)
  }

  /**
   * Fee data.
   *
   * Returns values of a working EIP-1559 network: a refusal here
   * would mean a node that cannot prepare any transaction, and
   * such a node is useless even as a double.
   */
  getFeeData(): Promise<IFeeData> {
    return Promise.resolve(
      this.#readFeeData() ?? {
        baseFeePerGas: 20_000_000_000n,
        maxFeePerGas: 30_000_000_000n,
        maxPriorityFeePerGas: 2_000_000_000n,
        gasPrice: 25_000_000_000n,
      },
    )
  }

  /**
   * Publish a signed transaction.
   *
   * Returns a constant hash: tests check that it reaches the UI,
   * not its specific value.
   */
  sendRawTransaction(): Promise<TxHash> {
    const failure = this.#readSendError()

    return failure === null ? Promise.resolve(FAKE_TX_HASH) : Promise.reject(new Error(failure))
  }

  getTransactionReceipt(): Promise<null> {
    return Promise.resolve(null)
  }

  /**
   * Log query.
   *
   * Filtering follows the same rules as on a node: block range,
   * contract address, and positional topic match, where `null`
   * means “any value”. A double that returns every record would
   * hide a bug in building the query — and that is what makes
   * operations vanish from history.
   */
  getLogs(filter: ILogFilter): Promise<readonly ILogEntry[]> {
    const failure = this.#readLogsError()

    return failure === null
      ? Promise.resolve(this.#readLogs().filter((entry) => matchesFilter(entry, filter)))
      : Promise.reject(new Error(failure))
  }

  destroy(): void {
    this.isActive = false
  }

  on = this.#events.on.bind(this.#events)
  once = this.#events.once.bind(this.#events)
  off = this.#events.off.bind(this.#events)
}

export interface IFakeAllowance {
  readonly contract: string
  readonly spender: string
  readonly amount: bigint
}

export interface IFakeOperatorApproval {
  readonly contract: string
  readonly operator: string
}

export interface IFakeNftOwner {
  readonly contract: string
  readonly tokenId: bigint
  readonly owner: string
}

export interface IFakeNftBalance {
  readonly contract: string
  readonly tokenId: bigint
  readonly balance: bigint
}

export interface IFakeCollection {
  readonly address: string
  readonly name: string
}

export interface IFakeToken {
  readonly address: string
  readonly symbol: string
  readonly name: string
  readonly decimals: number

  /** Owner balance. One for all: address matching is not what this checks. */
  readonly balance: bigint
}

export interface IFakeProviderOptions {
  /**
   * Id the node will report for `eth_chainId`.
   * If unset, the one declared in the config is returned.
   */
  readonly reportedChainId?: ChainId

  readonly unavailable?: boolean

  /** Balance returned by `getBalance`. Without it the method refuses. */
  readonly balance?: Wei

  /**
   * Per-address balances.
   *
   * Needed by used-address discovery: it distinguishes a used
   * address from an empty one, and one balance for every address
   * would make the check meaningless.
   */
  readonly balancesByAddress?: readonly { readonly address: string; readonly balance: Wei }[]

  /**
   * Verify chainId on create, as `RpcClientFactory` does.
   *
   * Off by default: `NetworkService` checks the id itself, after
   * the connection is created, and it needs a provider that
   * answers with a foreign value.
   *
   * When on, the check reproduces the production factory fully,
   * including wrapping the cause: the outside sees
   * `ProviderUnavailableError` with `cause` a
   * `ChainIdMismatchError`. Without that precision a test would
   * miss the real refusal reason being lost along the way.
   */
  readonly verifyChainIdOnCreate?: boolean

  /** Fee data. Without it, values of a working network are returned. */
  readonly feeData?: IFeeData

  /** Send failure reason. Without it, publish succeeds. */
  readonly sendError?: string

  readonly logs?: readonly ILogEntry[]

  /**
   * Address whose calls revert with the given reason.
   *
   * Needed by preflight checks: without a revert there is nothing
   * to prove the contract reason reaches the screen.
   */
  readonly callRevert?: { readonly to: string; readonly reason: string }

  /**
   * The node does not answer `eth_call`.
   *
   * Different from a revert: there the call ran and was rejected;
   * here it never ran, and there is nothing to say about it.
   */
  readonly callFails?: boolean

  /**
   * Latest block number.
   *
   * Affects the log-query window: the history source looks back
   * from the latest block.
   */
  readonly latestBlock?: bigint

  /**
   * Token contracts that answer `decimals`, `symbol`, `name`,
   * and `balanceOf`.
   *
   * Needed by token-send checks: without a contract reply a token
   * cannot be added or have its balance valued, and the whole
   * path would stay untested.
   */
  readonly tokens?: readonly IFakeToken[]

  /** ERC-721 owners. An item with no record is treated as burned. */
  readonly nftOwners?: readonly IFakeNftOwner[]

  /** ERC-1155 balances. No record means a zero balance. */
  readonly nftBalances?: readonly IFakeNftBalance[]

  /** Collection names. No record means the contract refuses. */
  readonly collections?: readonly IFakeCollection[]

  /** Active ERC-20 allowances. No record means a zero allowance. */
  readonly allowances?: readonly IFakeAllowance[]

  readonly operatorApprovals?: readonly IFakeOperatorApproval[]

  /** Log-query failure reason. Without it the query succeeds. */
  readonly logsError?: string

  /** Addresses for which `getCode` returns bytecode. None by default. */
  readonly contractAddresses?: readonly string[]

  /** ENS records. By default the registry is empty and answers zeros. */
  readonly ensRecords?: readonly IFakeEnsRecord[]
}

/**
 * ENS record in the double.
 *
 * STORED BY NAME, NOT BY NODE. The double computes `namehash` with
 * the same code as the production service and answers by node. A
 * namehash bug then fails the test instead of matching two equally
 * wrong values.
 */
export interface IFakeEnsRecord {
  /** Normalized name as the registry will see it. */
  readonly name: string

  /**
   * Address from the `addr` record. `null` means “resolver exists,
   * record does not”.
   */
  readonly address: string | null

  /**
   * Address for which this record is declared as reverse.
   *
   * Set separately from `address` on purpose: reverse is checked
   * by nobody, and a test must be able to describe a mismatch —
   * an address claims a name that does not point at it.
   */
  readonly reverseFor?: string
}

/** Resolver address the double returns. Arbitrary and constant. */
const FAKE_RESOLVER = toAddress(`0x${'11'.repeat(20)}`)

const ZERO_WORD = '0'.repeat(64)

function encodeAddressWord(address: string): HexString {
  return `0x${address.slice(2).toLowerCase().padStart(64, '0')}` as HexString
}

/** Encodes a string the ABI way: offset, length, content. */
function encodeStringResult(value: string): HexString {
  const bytes = new TextEncoder().encode(value)

  let content = ''

  for (const byte of bytes) {
    content += byte.toString(16).padStart(2, '0')
  }

  const padded = content.padEnd(Math.ceil(content.length / 64) * 64, '0')
  const offset = (32).toString(16).padStart(64, '0')
  const length = bytes.length.toString(16).padStart(64, '0')

  return `0x${offset}${length}${padded}` as HexString
}

/**
 * Answers a registry or ENS resolver call.
 *
 * @returns `null` if the call is unrelated to ENS.
 */
function answerEnsCall(
  request: ICallRequest,
  records: readonly IFakeEnsRecord[],
): HexString | null {
  const data = request.data ?? '0x'
  const node = `0x${data.slice(10)}`

  if (areAddressesEqual(request.to, ENS_REGISTRY_ADDRESS)) {
    if (!data.startsWith(`0x${ENS_RESOLVER_SELECTOR}`)) {
      return null
    }

    /* The resolver is returned for both the forward name node and
       the reverse address node: both are registered if a record
       exists for them. */
    const known =
      records.some((record) => namehash(record.name) === node) ||
      records.some(
        (record) =>
          record.reverseFor !== undefined && reverseNode(toAddress(record.reverseFor)) === node,
      )

    return known ? encodeAddressWord(FAKE_RESOLVER) : (`0x${ZERO_WORD}` as HexString)
  }

  if (!areAddressesEqual(request.to, FAKE_RESOLVER)) {
    return null
  }

  if (data.startsWith(`0x${ENS_ADDR_SELECTOR}`)) {
    const record = records.find((entry) => namehash(entry.name) === node)

    return record?.address == null
      ? (`0x${ZERO_WORD}` as HexString)
      : encodeAddressWord(record.address)
  }

  if (data.startsWith(`0x${ENS_NAME_SELECTOR}`)) {
    const record = records.find(
      (entry) =>
        entry.reverseFor !== undefined && reverseNode(toAddress(entry.reverseFor)) === node,
    )

    return record === undefined ? (`0x${ZERO_WORD}` as HexString) : encodeStringResult(record.name)
  }

  return null
}

function matchesFilter(entry: ILogEntry, filter: ILogFilter): boolean {
  if (filter.fromBlock !== undefined && entry.blockNumber < filter.fromBlock) {
    return false
  }

  if (filter.toBlock !== undefined && entry.blockNumber > filter.toBlock) {
    return false
  }

  if (
    filter.address !== undefined &&
    filter.address.toLowerCase() !== entry.address.toLowerCase()
  ) {
    return false
  }

  return (filter.topics ?? []).every(
    (topic, position) =>
      topic === null || topic.toLowerCase() === entry.topics[position]?.toLowerCase(),
  )
}

/**
 * Hash returned on publish.
 *
 * Constant: tests check that the value reaches the UI, not which
 * value it is.
 */
const FAKE_TX_HASH = `0x${'ab'.repeat(32)}` as TxHash

export class FakeProviderFactory implements IProviderFactory {
  #options: IFakeProviderOptions = {}

  /** Providers created. Lets a test check that the connection is closed. */
  createdCount = 0

  /** Last created provider. Used to check that destroy was called. */
  lastProvider: IProvider | null = null

  configure(options: IFakeProviderOptions): void {
    this.#options = options
  }

  create(network: INetworkConfig): Promise<IProvider> {
    if (this.#options.unavailable === true) {
      return Promise.reject(new ProviderUnavailableError(network.chainId))
    }

    const reportedChainId = this.#options.reportedChainId ?? network.chainId

    if (this.#options.verifyChainIdOnCreate === true && reportedChainId !== network.chainId) {
      return Promise.reject(
        new ProviderUnavailableError(network.chainId, {
          cause: new ChainIdMismatchError(network.chainId, reportedChainId),
        }),
      )
    }

    const provider = new FakeProvider(
      network.chainId,
      reportedChainId,
      () => this.#options.balance ?? null,
      () => this.#options.balancesByAddress ?? [],
      () => this.#options.feeData ?? null,
      () => this.#options.sendError ?? null,
      () => this.#options.logs ?? [],
      () => this.#options.latestBlock ?? 0n,
      () => this.#options.contractAddresses ?? [],
      () => this.#options.ensRecords ?? [],
      () => this.#options.tokens ?? [],
      () => ({
        owners: this.#options.nftOwners ?? [],
        balances: this.#options.nftBalances ?? [],
        names: this.#options.collections ?? [],
      }),
      () => ({
        allowances: this.#options.allowances ?? [],
        operators: this.#options.operatorApprovals ?? [],
      }),
      () => this.#options.logsError ?? null,
      () => this.#options.callRevert ?? null,
      () => this.#options.callFails ?? false,
    )

    this.createdCount += 1
    this.lastProvider = provider

    return Promise.resolve(provider)
  }
}

/**
 * Encodes `Error(string)` the way the virtual machine does.
 *
 * The double must answer in the same form as a node: parsing that
 * data is what is being checked.
 */
function encodeErrorString(text: string): string {
  const bytes = new TextEncoder().encode(text)
  const body = [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('')
  const offset = 32n.toString(16).padStart(64, '0')
  const length = BigInt(bytes.length).toString(16).padStart(64, '0')

  return `0x${functionSelector('Error(string)')}${offset}${length}${body.padEnd(Math.ceil(body.length / 64) * 64, '0')}`
}

/**
 * Token-contract reply.
 *
 * Calls are distinguished by selector — the way a real contract
 * does. A double that answers every call the same way would hide
 * a bug in building the data.
 */
function answerTokenCall(request: ICallRequest, tokens: readonly IFakeToken[]): HexString | null {
  const token = tokens.find((entry) => areAddressesEqual(entry.address, request.to))

  if (token === undefined) {
    return null
  }

  const data = request.data ?? '0x'

  if (data.startsWith(`0x${DECIMALS_SELECTOR}`)) {
    return word(BigInt(token.decimals))
  }

  if (data.startsWith(`0x${BALANCE_OF_SELECTOR}`)) {
    return word(token.balance)
  }

  if (data.startsWith(`0x${SYMBOL_SELECTOR}`)) {
    return text(token.symbol)
  }

  if (data.startsWith(`0x${NAME_SELECTOR}`)) {
    return text(token.name)
  }

  return null
}

function word(value: bigint): HexString {
  return `0x${value.toString(16).padStart(64, '0')}` as HexString
}

/** Variable-length ABI string: offset, length, content. */
function text(value: string): HexString {
  const encoded = new TextEncoder().encode(value)
  const bytes = [...encoded].map((byte) => byte.toString(16).padStart(2, '0')).join('')

  /* LENGTH IN BYTES, NOT CHARACTERS. ABI encoding declares string
     length as a byte count; `value.length` counts UTF-16 units.
     For ASCII the numbers match, so the mismatch was invisible —
     and any non-ASCII contract string was cut mid-character and
     reached the wallet corrupted. A Cyrillic-symbol spoof check
     on such a double would fail silently. */
  const length = BigInt(encoded.length).toString(16).padStart(64, '0')
  const padded = bytes.padEnd(Math.max(64, Math.ceil(bytes.length / 64) * 64), '0')

  return `0x${32n.toString(16).padStart(64, '0')}${length}${padded}` as HexString
}

export interface IFakeCollections {
  readonly owners: readonly IFakeNftOwner[]
  readonly balances: readonly IFakeNftBalance[]
  readonly names: readonly IFakeCollection[]
}

/**
 * Collection-contract reply.
 *
 * Returns `null` if the call is unrelated to collections, and
 * `Error` if the contract must refuse: `ownerOf` of a missing item
 * reverts, and that is how a burned item looks.
 */
function answerCollectionCall(
  request: ICallRequest,
  state: IFakeCollections,
): HexString | Error | null {
  const data = request.data ?? '0x'

  if (data.startsWith(`0x${OWNER_OF_SELECTOR}`)) {
    const tokenId = BigInt(`0x${data.slice(10)}`)
    const record = state.owners.find(
      (entry) => areAddressesEqual(entry.contract, request.to) && entry.tokenId === tokenId,
    )

    return record === undefined
      ? new Error('ERC721: invalid token ID')
      : (`0x${record.owner.slice(2).toLowerCase().padStart(64, '0')}` as HexString)
  }

  if (data.startsWith(`0x${ERC1155_BALANCE_OF_SELECTOR}`)) {
    const tokenId = BigInt(`0x${data.slice(74)}`)
    const record = state.balances.find(
      (entry) => areAddressesEqual(entry.contract, request.to) && entry.tokenId === tokenId,
    )

    return `0x${(record?.balance ?? 0n).toString(16).padStart(64, '0')}` as HexString
  }

  /* Name is asked of both collections and ERC-20 tokens. Only
     known collections answer here; the rest is passed on. */
  if (data.startsWith(`0x${NAME_SELECTOR}`)) {
    const record = state.names.find((entry) => areAddressesEqual(entry.address, request.to))

    return record === undefined ? null : text(record.name)
  }

  return null
}

export interface IFakeApprovals {
  readonly allowances: readonly IFakeAllowance[]
  readonly operators: readonly IFakeOperatorApproval[]
}

/**
 * Contract reply for reading an approval.
 *
 * A missing record means zero and `false` — “no approval”, not a
 * refusal: a real contract answers the same way.
 */
function answerApprovalCall(request: ICallRequest, state: IFakeApprovals): HexString | null {
  const data = request.data ?? '0x'

  if (data.startsWith(`0x${ALLOWANCE_SELECTOR}`)) {
    const spender = `0x${data.slice(-40)}`
    const record = state.allowances.find(
      (entry) =>
        areAddressesEqual(entry.contract, request.to) && areAddressesEqual(entry.spender, spender),
    )

    return `0x${(record?.amount ?? 0n).toString(16).padStart(64, '0')}` as HexString
  }

  if (data.startsWith(`0x${IS_APPROVED_FOR_ALL_SELECTOR}`)) {
    const operator = `0x${data.slice(-40)}`
    const isApproved = state.operators.some(
      (entry) =>
        areAddressesEqual(entry.contract, request.to) &&
        areAddressesEqual(entry.operator, operator),
    )

    return `0x${(isApproved ? 1n : 0n).toString(16).padStart(64, '0')}` as HexString
  }

  return null
}
