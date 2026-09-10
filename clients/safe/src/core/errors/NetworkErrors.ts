import { AppError } from './AppError'
import { ERROR_CODE, type ErrorCode } from './ErrorCode'

export class NetworkNotFoundError extends AppError {
  readonly code: ErrorCode = ERROR_CODE.NetworkNotFound

  constructor(chainId: bigint) {
    super(`Network with chainId ${chainId.toString()} was not found.`)
  }
}

export class NetworkAlreadyExistsError extends AppError {
  readonly code: ErrorCode = ERROR_CODE.NetworkAlreadyExists

  constructor(chainId: bigint) {
    super(`Network with chainId ${chainId.toString()} has already been added.`)
  }
}

/**
 * Attempt to change or remove a built-in network.
 *
 * Built-in networks are immutable on purpose. Being able to edit the
 * mainnet chainId or RPC through the add-network UI is a known phishing
 * trick: the user is offered to "speed up Ethereum" while the node is
 * swapped for a controlled one.
 */
export class BuiltInNetworkImmutableError extends AppError {
  readonly code: ErrorCode = ERROR_CODE.BuiltInNetworkImmutable

  constructor(chainId: bigint) {
    super(`Built-in network ${chainId.toString()} cannot be changed or removed.`)
  }
}

/**
 * The RPC address is not a valid URL.
 *
 * Separate from {@link InsecureRpcUrlError}: the string did not parse
 * at all, so talking about the protocol is meaningless.
 */
export class InvalidRpcUrlError extends AppError {
  readonly code: ErrorCode = ERROR_CODE.InvalidRpcUrl

  constructor(value: string) {
    super(`The value "${value}" is not a valid URL.`)
  }
}

/**
 * The RPC address uses an insecure protocol.
 *
 * Plain HTTP means a channel intermediary can swap the balance, nonce,
 * gas price, and contract-call result. The user would sign a
 * transaction other than the one they see on screen. Only `https:`
 * and `wss:` are allowed.
 */
export class InsecureRpcUrlError extends AppError {
  readonly code: ErrorCode = ERROR_CODE.InsecureRpcUrl

  constructor(protocol: string) {
    super(`The protocol "${protocol}" is not allowed for RPC. Only https and wss are permitted.`)
  }
}

/**
 * The node reported a chainId other than the expected one.
 *
 * The most dangerous network-layer error. A swapped or misconfigured
 * node makes the wallet sign a transaction for one network while the
 * user is shown another. The resulting signature can be replayed on
 * the target network.
 *
 * Handling: drop the node connection immediately. Continuing on a
 * mismatch is forbidden in every case.
 */
export class ChainIdMismatchError extends AppError {
  readonly code: ErrorCode = ERROR_CODE.ChainIdMismatch

  readonly expected: bigint

  readonly actual: bigint

  constructor(expected: bigint, actual: bigint) {
    super(
      `The node returned chainId ${actual.toString()}, expected ${expected.toString()}. ` +
        'The connection was lost.',
    )
    this.expected = expected
    this.actual = actual
  }
}

/**
 * The network being added wears a built-in name but serves another chain.
 *
 * The main network-spoofing trick. A site offers to add a network with
 * a familiar name and its own identifier; a chainId check against the
 * node lets it through because the node honestly reports its id.
 * The wallet header shows a familiar name, and the user signs a
 * transfer thinking it is going to mainnet.
 *
 * Handling: show the user which network the addition impersonates, and
 * add it only on explicit consent — the `allowImpersonation` parameter.
 */
export class NetworkImpersonationError extends AppError {
  readonly code: ErrorCode = ERROR_CODE.NetworkImpersonation

  readonly impersonatedName: string

  readonly impersonatedChainId: bigint

  /**
   * The name is written with letters from other alphabets.
   *
   * A DISTINCTION THAT MUST REACH THE PERSON. On a letter-for-letter
   * match they see two identical names and understand the message at
   * once. On a lookalike-character swap they see two VISUALLY
   * IDENTICAL names and a "name taken" message — without explanation
   * it looks like a wallet bug, i.e. a reason to press "add anyway".
   */
  readonly foreignCharacters: readonly string[]

  constructor(
    impersonatedName: string,
    impersonatedChainId: bigint,
    actualChainId: bigint,
    foreignCharacters: readonly string[] = [],
  ) {
    super(
      foreignCharacters.length === 0
        ? `A network named "${impersonatedName}" already exists and has chainId ` +
            `${impersonatedChainId.toString()}, while the one being added has ${actualChainId.toString()}. ` +
            'A matching name with a different identifier is a common network spoofing trick.'
        : `The name is written with letters from another alphabet (${foreignCharacters.join(' ')}) ` +
            `so that it looks exactly like "${impersonatedName}", which has chainId ` +
            `${impersonatedChainId.toString()} — the one being added has ${actualChainId.toString()}. ` +
            'The two names are indistinguishable on screen, and that is the whole point of the trick.',
    )
    this.impersonatedName = impersonatedName
    this.impersonatedChainId = impersonatedChainId
    this.foreignCharacters = foreignCharacters
  }
}

/**
 * The node did not answer.
 *
 * WHY THE TEXT IS REPLACEABLE. The error arises in two different
 * situations: when the list has been exhausted — and then there
 * really are no addresses left — and when one node failed one request
 * while the other addresses are fine. One text for both is a lie in
 * one of them: an "exhausted list" message reached the history screen
 * with two healthy nodes.
 *
 * So a caller that knows the detail passes `reason`. Without it the
 * old text remains — it is correct for an exhausted list.
 */
export class ProviderUnavailableError extends AppError {
  readonly code: ErrorCode = ERROR_CODE.ProviderUnavailable

  constructor(chainId: bigint, options?: ErrorOptions & { readonly reason?: string }) {
    super(options?.reason ?? `No RPC endpoints are available for network ${chainId.toString()}.`, {
      ...(options?.cause === undefined ? {} : { cause: options.cause }),
    })
  }
}

/**
 * The node returned a JSON-RPC error.
 *
 * `rpcCode` is kept separately: JSON-RPC codes are standardised, and
 * handling must rely on them, not on the message text, which differs
 * across node implementations.
 */
export class RpcError extends AppError {
  readonly code: ErrorCode = ERROR_CODE.RpcError

  readonly rpcCode: number

  readonly data: unknown

  constructor(rpcCode: number, message: string, data?: unknown) {
    super(`RPC error ${String(rpcCode)}: ${message}`)
    this.rpcCode = rpcCode
    this.data = data
  }
}
