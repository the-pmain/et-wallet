import { TypedDataEncoder } from 'ethers'

import { InvalidArgumentError } from '@/core/errors'
import type { ITypedData } from '@/core/transaction'
import { toChainId, type ChainId, type HexString } from '@/core/types'

/**
 * EIP-712 domain type name.
 *
 * Present in an `eth_signTypedData_v4` payload, but MUST NOT be passed
 * to the encoder: it derives the domain from a separate argument and
 * throws if it finds this type among the others. A standard
 * requirement, not a library quirk.
 */
const EIP712_DOMAIN_TYPE = 'EIP712Domain'

/**
 * Removes the domain service type from the type set.
 *
 * A new object is returned: the payload comes from a dApp, and
 * mutating it in place is forbidden — the caller may be showing the
 * user that original structure.
 */
export function stripDomainType(
  types: ITypedData['types'],
): Record<string, readonly { name: string; type: string }[]> {
  const result: Record<string, readonly { name: string; type: string }[]> = {}

  for (const [name, fields] of Object.entries(types)) {
    if (name !== EIP712_DOMAIN_TYPE) {
      result[name] = fields
    }
  }

  return result
}

/**
 * Checks that a structure is fit to sign.
 *
 * THE MAIN CHECK — `domain.chainId` matches the active network.
 *
 * An EIP-712 signature is bound to a network only through this field.
 * A structure with a foreign chainId, signed on one network, is
 * presented to a contract on another. Classic scenario: the user is
 * shown a "site login", and the signed message is a `Permit` to spend
 * tokens on mainnet.
 *
 * The check runs BEFORE signing and cannot be optional: silently
 * coercing chainId to the active one would change the signed data,
 * and skipping the check would leave the attack open.
 *
 * WHAT THIS CHECK DOES NOT DO. It does not judge the meaning of what
 * is signed. An unlimited token allowance is a valid structure with
 * the right chainId. Parsing dangerous templates (`Permit`,
 * `PermitSingle`, Seaport orders) is the job of the layer that shows
 * confirmation to the user.
 *
 * @throws InvalidArgumentError on a network mismatch or a broken
 *         structure.
 */
export function assertTypedDataMatchesChain(data: ITypedData, expectedChainId: ChainId): void {
  if (typeof data.primaryType !== 'string' || data.primaryType.length === 0) {
    throw new InvalidArgumentError('typedData.primaryType', 'the primary type is missing')
  }

  if (!Object.prototype.hasOwnProperty.call(data.types, data.primaryType)) {
    throw new InvalidArgumentError(
      'typedData.primaryType',
      `the type "${data.primaryType}" is missing from the type set`,
    )
  }

  const domainChainId = data.domain.chainId

  if (domainChainId === undefined) {
    /* A domain without chainId is allowed by the standard, but for a
       wallet it means a signature valid on every network at once.
       The refusal is deliberate. */
    throw new InvalidArgumentError(
      'typedData.domain.chainId',
      'a structure without a chain identifier is valid in every network at once',
    )
  }

  /* The value comes from a dApp payload: it is declared as ChainId
     but may in fact be anything. The validating constructor rejects
     an illegal value before comparison. */
  const actual = toChainId(domainChainId)

  if (actual !== expectedChainId) {
    throw new InvalidArgumentError(
      'typedData.domain.chainId',
      `the structure targets network ${actual.toString()}, ` +
        `while network ${expectedChainId.toString()} is active`,
    )
  }
}

/**
 * Computes the EIP-712 digest of a structure.
 *
 * This is exactly the value that will be signed. The caller must be
 * able to obtain it separately from the signature: the user must see
 * what is being signed, and comparing the hash is the only way to
 * confirm that what was shown and what was signed match.
 */
export function hashTypedData(data: ITypedData): HexString {
  return TypedDataEncoder.hash(
    toEthersDomain(data.domain),
    stripDomainType(data.types) as Record<string, { name: string; type: string }[]>,
    data.message as Record<string, unknown>,
  ) as HexString
}

export function toEthersDomain(domain: ITypedData['domain']): Record<string, unknown> {
  return {
    ...(domain.name === undefined ? {} : { name: domain.name }),
    ...(domain.version === undefined ? {} : { version: domain.version }),
    ...(domain.chainId === undefined ? {} : { chainId: domain.chainId }),
    ...(domain.verifyingContract === undefined
      ? {}
      : { verifyingContract: domain.verifyingContract }),
    ...(domain.salt === undefined ? {} : { salt: domain.salt }),
  }
}
