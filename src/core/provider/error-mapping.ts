import { isError, type EthersError } from 'ethers'

import {
  GasEstimationFailedError,
  InsufficientFundsError,
  NonceTooLowError,
  ProviderUnavailableError,
  RpcError,
  TransactionUnderpricedError,
} from '@/core/errors'
import type { ChainId } from '@/core/types'

/**
 * JSON-RPC code for an internal node error.
 * Used when the response has no original code.
 */
const JSON_RPC_INTERNAL_ERROR = -32603

/**
 * Maps an ethers error to a domain error.
 *
 * WHY. Ethers errors belong to an external library. Letting them leak
 * would bind the whole domain to its current set of codes: replacing
 * ethers with viem would force a change in every error handler.
 *
 * Second, and more important: ethers errors carry technical details
 * unfit to show the user. "CALL_EXCEPTION" says nothing about what
 * to do; "insufficient funds" does. Mapping codes to domain errors
 * happens once here, not at every call site.
 *
 * Message-text parsing is NOT used: wording is not part of the public
 * contract of ethers or of nodes. Only codes are distinguished.
 */
export function mapProviderError(error: unknown, chainId: ChainId): Error {
  if (isError(error, 'INSUFFICIENT_FUNDS')) {
    /* Ethers does not report exact amounts: the node returns only the
       fact of shortage. Zeros mean "unknown", and the UI must show a
       generic message, not "required 0". */
    return new InsufficientFundsError(0n, 0n)
  }

  if (isError(error, 'NONCE_EXPIRED')) {
    return new NonceTooLowError(0, 0)
  }

  if (isError(error, 'REPLACEMENT_UNDERPRICED')) {
    return new TransactionUnderpricedError()
  }

  if (isError(error, 'CALL_EXCEPTION')) {
    /* The call reverted. During gas estimation that means the
       transaction itself would revert: it must not be sent — gas would
       be spent and the operation would not run. */
    return new GasEstimationFailedError(error.reason ?? 'the call reverted', {
      cause: error,
      /* Revert data reaches the caller. The library only unwraps the
         standard `Error(string)` reason; custom contract errors stay
         a four-byte selector, and losing it would leave no way to name
         the failure. */
      revertData: readRevertData(error),
    })
  }

  if (isError(error, 'NETWORK_ERROR') || isError(error, 'TIMEOUT')) {
    /* The node is unreachable or did not answer in time. This is not
       an operation error but a transport failure: the caller may retry
       on another node. */
    return new ProviderUnavailableError(chainId, { cause: error })
  }

  if (isEthersError(error)) {
    /* The original JSON-RPC error is extracted regardless of how
       ethers classified it. The node's code is more informative than
       the library's own: `-32005` reports a rate limit, `UNKNOWN_ERROR`
       reports nothing. */
    const nested = extractJsonRpcError(error)

    if (nested !== null) {
      return new RpcError(nested.code, nested.message, error)
    }

    /* The node answered with an HTTP status but not a JSON-RPC body:
       there is no `code`/`message` payload — otherwise it would have
       been parsed above. This is a node failure, not a negative answer
       to the request.

       WHY THE DISTINCTION MATTERS. `FailoverProvider` rotates backups
       only on `ProviderUnavailableError`, and for good reason:
       insufficient funds and a reverted call do not depend on whom
       you ask — a second node would answer the same. But "500" says
       nothing about chain state, it says something about the node,
       and a neighbor may answer. Returning `RpcError` here treated a
       node failure as its answer and thereby forbade switching:
       backups were configured and unused.

       It showed up on log queries — `eth_getLogs` is heavier than
       other calls and fails first — but everything was affected.

       The `-32603` in the previous branch was invented here: the node
       never sent it. Substituting a missing answer with an invented
       code is the same mistake as substituting unknown with zero.

       Dropping an address is not permanent: `RpcManager` puts it on
       cooldown, and when every address is on cooldown it takes the
       full list again. */
    if (isError(error, 'SERVER_ERROR')) {
      /* Text comes from the library: it names the HTTP status
         ("server response 500") and therefore says more about what
         happened than a generic "no addresses" phrase — the addresses
         may still be intact; only one node failed on one request. */
      return new ProviderUnavailableError(chainId, {
        cause: error,
        /* Trim is not cosmetic: the library concatenates the status
           with a reason, and an empty reason leaves a trailing space.
           That space ends up inside quotes on the history screen. */
        reason: error.shortMessage.trim(),
      })
    }

    return new RpcError(JSON_RPC_INTERNAL_ERROR, error.shortMessage, error)
  }

  return error instanceof Error ? error : new Error(String(error))
}

/**
 * Revert data from a library error.
 *
 * The field is optional and untrusted: the node may omit data, and the
 * library may leave the field empty. Both presence and type are checked.
 */
function readRevertData(error: unknown): string | null {
  const data = (error as { data?: unknown }).data

  return typeof data === 'string' && data.startsWith('0x') ? data : null
}

function isEthersError(error: unknown): error is EthersError {
  return (
    error instanceof Error &&
    typeof (error as Partial<EthersError>).code === 'string' &&
    typeof (error as Partial<EthersError>).shortMessage === 'string'
  )
}

/**
 * Extracts the original JSON-RPC error from an ethers wrapper.
 *
 * The library stores the node response in different places depending
 * on where the failure happened: payload handling puts it in `error`,
 * transport failures put it in `info.error`. Both are checked.
 *
 * The response is untrusted: fields may be missing or of any type,
 * so each is checked separately.
 */
function extractJsonRpcError(error: EthersError): { code: number; message: string } | null {
  const candidates = [
    (error as { error?: unknown }).error,
    (error as { info?: { error?: unknown } }).info?.error,
  ]

  for (const candidate of candidates) {
    if (typeof candidate !== 'object' || candidate === null) {
      continue
    }

    const { code, message } = candidate as { code?: unknown; message?: unknown }

    if (typeof code === 'number') {
      return {
        code,
        message: typeof message === 'string' ? message : error.shortMessage,
      }
    }
  }

  return null
}
