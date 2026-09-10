import { areAddressesEqual, isBurnAddress } from '@/core/address'
import { functionSelector } from '@/core/token'
import type { Address, ChainId, HexString } from '@/core/types'

import { DAPP_REQUEST_KIND, type IDappRequest } from './types'

/**
 * Kinds of remarks on a request from an application.
 *
 * WHY THIS MODULE EXISTS AT ALL. The remote side asks to sign, and
 * a signature cannot be revoked. Showing the user a structure hash
 * means showing nothing: they will press "sign" because otherwise
 * the application does not work. That is exactly how an unlimited
 * token allowance is given, noticing neither a debit nor a fee.
 */
export const DAPP_RISK = {
  /** The signature grants permission to dispose of tokens. */
  TokenPermit: 'token-permit',
  /** The allowance is issued with no amount cap. */
  UnlimitedAllowance: 'unlimited-allowance',
  /** An `approve` call in the transaction. */
  ApprovalCall: 'approval-call',
  /** The structure is signed for another network. */
  ChainMismatch: 'chain-mismatch',
  /** The verifying contract is not specified. */
  MissingVerifyingContract: 'missing-verifying-contract',
  /** The message looks like a serialised transaction. */
  MessageLooksLikeTransaction: 'message-looks-like-transaction',
  /** The message contains non-printable characters and is unreadable. */
  UnreadableMessage: 'unreadable-message',
  /** The transaction sends funds to a burn address. */
  BurnRecipient: 'burn-recipient',
  /** The transaction creates a contract: there is no recipient. */
  ContractDeployment: 'contract-deployment',
  /** The transaction carries call data whose meaning is not parsed. */
  OpaqueCallData: 'opaque-call-data',
} as const

export type DappRisk = (typeof DAPP_RISK)[keyof typeof DAPP_RISK]

/**
 * Selector of `approve(address,uint256)`.
 *
 * COMPUTED, NOT WRITTEN IN. Four bytes copied from memory cannot
 * be checked by reading the code: an error in one character
 * silently turns the warning off — and that is the warning the
 * whole module was written for.
 */
const APPROVE_SELECTOR = `0x${functionSelector('approve(address,uint256)')}`

/** Selector of `setApprovalForAll(address,bool)` — allowance for a whole NFT collection. */
const SET_APPROVAL_FOR_ALL_SELECTOR = `0x${functionSelector('setApprovalForAll(address,bool)')}`

/**
 * Threshold above which an allowance is treated as unlimited.
 *
 * Applications issue either `2^256 − 1` or nearby round values.
 * Comparing to an exact constant would miss `2^255`, so a
 * threshold is used: an amount above it certainly exceeds the
 * supply of any real token and differs from "unlimited" only
 * formally.
 */
const UNLIMITED_THRESHOLD = 2n ** 200n

/**
 * EIP-712 structure names that grant disposal of tokens.
 *
 * The list is exactly this because each name is fixed by a
 * standard or a widespread implementation: `Permit` — EIP-2612,
 * `PermitSingle` and `PermitBatch` — Permit2, `PermitForAll` — a
 * variant for NFT collections.
 */
const PERMIT_TYPES: readonly string[] = [
  'Permit',
  'PermitSingle',
  'PermitBatch',
  'PermitForAll',
  'PermitTransferFrom',
]

export interface IDappRiskFinding {
  readonly risk: DappRisk

  /**
   * Qualifying value: allowance amount, foreign network id.
   * `null` if the remark needs no details.
   */
  readonly detail: string | null
}

/**
 * Parses a request and lists everything that should raise concern.
 *
 * THE FUNCTION IS PURE AND DOES NOT HIT THE NETWORK. Every request
 * will have to be checked, and a node call inside would mean a
 * delay before the screen where the user is already in a hurry to
 * press "confirm".
 *
 * REMARKS ARE NOT BANS. A token allowance is sometimes needed:
 * no exchange works without it. The job is to name the consequence
 * before the signature, not to decide for the owner of the funds.
 *
 * @param activeChainId Network selected in the wallet. Divergence
 *        from the request network is a separate remark: a
 *        signature made "elsewhere" may be valid where it was not
 *        expected.
 */
export function findDappRisks(
  request: IDappRequest,
  activeChainId: ChainId | null,
): readonly IDappRiskFinding[] {
  const findings: IDappRiskFinding[] = []

  if (activeChainId !== null && request.chainId !== activeChainId) {
    findings.push({
      risk: DAPP_RISK.ChainMismatch,
      detail: `the request targets network ${request.chainId.toString()}, while the wallet is on ${activeChainId.toString()}`,
    })
  }

  switch (request.payload.kind) {
    case DAPP_REQUEST_KIND.SignMessage:
      findings.push(...inspectMessage(request.payload.message))
      break

    case DAPP_REQUEST_KIND.SignTypedData:
      findings.push(...inspectTypedData(request.payload.typedData))
      break

    case DAPP_REQUEST_KIND.SendTransaction:
    case DAPP_REQUEST_KIND.SignTransaction:
      findings.push(...inspectTransaction(request.payload.transaction))
      break
  }

  return findings
}

function inspectMessage(message: string): readonly IDappRiskFinding[] {
  const findings: IDappRiskFinding[] = []

  /*
    A message that looks like hex data cannot be read by the user.
    The EIP-191 prefix keeps such a signature from becoming a
    transaction signature, but the person does not know that and
    signs the unintelligible.
  */
  if (/^0x[0-9a-fA-F]{64,}$/u.test(message.trim())) {
    findings.push({
      risk: DAPP_RISK.MessageLooksLikeTransaction,
      detail: null,
    })
  }

  /* Non-printable characters make the message unreadable and let
     part of the text be hidden from the eye. */
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x08\x0e-\x1f]/u.test(message)) {
    findings.push({ risk: DAPP_RISK.UnreadableMessage, detail: null })
  }

  return findings
}

function inspectTypedData(typedData: {
  readonly primaryType: string
  readonly domain: { readonly chainId?: ChainId; readonly verifyingContract?: Address }
  readonly message: Readonly<Record<string, unknown>>
}): readonly IDappRiskFinding[] {
  const findings: IDappRiskFinding[] = []

  if (PERMIT_TYPES.includes(typedData.primaryType)) {
    findings.push({ risk: DAPP_RISK.TokenPermit, detail: typedData.primaryType })

    const amount = findAllowanceAmount(typedData.message)

    if (amount !== null && amount >= UNLIMITED_THRESHOLD) {
      findings.push({
        risk: DAPP_RISK.UnlimitedAllowance,
        detail: 'the amount is unlimited',
      })
    }
  }

  /*
    Without `verifyingContract` it is impossible to say which
    contract the signature is for. The standard allows its absence,
    but for a token allowance that means a signature for persons
    unknown.
  */
  if (typedData.domain.verifyingContract === undefined) {
    findings.push({ risk: DAPP_RISK.MissingVerifyingContract, detail: null })
  }

  return findings
}

/**
 * Looks for the allowance amount among the structure fields.
 *
 * Field names differ between standards: `value` in EIP-2612,
 * `amount` in Permit2. Trying several names is more reliable than
 * binding to one — and certainly better than silence.
 */
function findAllowanceAmount(message: Readonly<Record<string, unknown>>): bigint | null {
  const direct = readBigInt(message['value']) ?? readBigInt(message['amount'])

  if (direct !== null) {
    return direct
  }

  /* Permit2 hides the amount in a nested `details` structure. */
  const details = message['details']

  if (typeof details === 'object' && details !== null) {
    return readBigInt((details as Record<string, unknown>)['amount'])
  }

  return null
}

function readBigInt(value: unknown): bigint | null {
  if (typeof value === 'bigint') {
    return value
  }

  if (typeof value === 'number' && Number.isSafeInteger(value)) {
    return BigInt(value)
  }

  if (typeof value === 'string' && /^(0x[0-9a-fA-F]+|\d+)$/u.test(value)) {
    return BigInt(value)
  }

  return null
}

function inspectTransaction(transaction: {
  readonly to: Address | null
  readonly data: HexString | null
  readonly from: Address
}): readonly IDappRiskFinding[] {
  const findings: IDappRiskFinding[] = []

  if (transaction.to === null) {
    /* A transaction without a recipient deploys a contract. For a
       wallet that is a rare and expensive action that must be
       named. */
    findings.push({ risk: DAPP_RISK.ContractDeployment, detail: null })

    return findings
  }

  if (isBurnAddress(transaction.to)) {
    findings.push({ risk: DAPP_RISK.BurnRecipient, detail: null })
  }

  const data = transaction.data

  if (data === null || data === '0x') {
    return findings
  }

  const selector = data.slice(0, 10).toLowerCase()

  if (selector === APPROVE_SELECTOR.toLowerCase()) {
    const amount = readApproveAmount(data)

    findings.push({
      risk: DAPP_RISK.ApprovalCall,
      detail: amount !== null && amount >= UNLIMITED_THRESHOLD ? 'the amount is unlimited' : null,
    })

    if (amount !== null && amount >= UNLIMITED_THRESHOLD) {
      findings.push({ risk: DAPP_RISK.UnlimitedAllowance, detail: 'the amount is unlimited' })
    }

    return findings
  }

  if (selector === SET_APPROVAL_FOR_ALL_SELECTOR.toLowerCase()) {
    findings.push({
      risk: DAPP_RISK.ApprovalCall,
      detail: 'approval covers the whole collection',
    })

    return findings
  }

  /*
    There is data, but the call is not recognised. Silence here
    would mean "we checked, all is well", whereas in fact we do
    not understand what is being signed.
  */
  findings.push({ risk: DAPP_RISK.OpaqueCallData, detail: selector })

  return findings
}

/**
 * Reads the amount from `approve` call data.
 *
 * The second argument occupies the second 32-byte word after the
 * selector. Parsing is simplified to fixed offsets: both `approve`
 * arguments are static, and a full ABI decoder would add nothing
 * here.
 */
function readApproveAmount(data: string): bigint | null {
  const body = data.slice(10)

  if (body.length < 128) {
    return null
  }

  try {
    return BigInt(`0x${body.slice(64, 128)}`)
  } catch {
    return null
  }
}

/**
 * Whether the sender address matches the expected one.
 *
 * Lifted here, not into the UI: the application is free to send a
 * transaction in someone else's name, and that must be a refusal,
 * not a remark. Signing a transaction whose sender is not our
 * account is impossible — but this must be checked before the
 * screen is shown, so the user is not asked about something that
 * cannot be done.
 */
export function isKnownSender(from: Address, ownAddresses: readonly Address[]): boolean {
  return ownAddresses.some((address) => areAddressesEqual(address, from))
}
