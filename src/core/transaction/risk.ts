import { areAddressesEqual, isBurnAddress } from '@/core/address'
import type { Address } from '@/core/types'

/** Kind of remark about the recipient. */
export const RECIPIENT_RISK = {
  /** Burn address: funds leave with no return. */
  BurnAddress: 'burn-address',
  /** Recipient matches the sender. */
  SelfTransfer: 'self-transfer',
  /** Address written without a checksum: a typo is not detected. */
  NoChecksum: 'no-checksum',
  /**
   * The recipient is a contract, not an ordinary address.
   *
   * Native currency sent to a contract that does not accept it
   * is lost for good: only the contract's own code can return it,
   * and that code may not exist. The most common case is sending
   * coins to a token-contract address.
   */
  ContractRecipient: 'contract-recipient',

  /**
   * The recipient is the contract of the asset being sent.
   *
   * THE MOST COMMON IRREVERSIBLE TOKEN MISTAKE. A person copies
   * the contract address — from an explorer, from the asset list,
   * from someone else's message — and pastes it into the recipient
   * field. The transfer succeeds: the contract credits tokens to
   * its own address. Only the contract's code can take them back,
   * and that code almost never exists.
   *
   * DIFFERS FROM `ContractRecipient` IN CERTAINTY. "The recipient
   * is a contract" is sometimes legitimate: exchanges, multisigs,
   * and vaults accept transfers. Sending an asset to its own
   * contract has no legitimate use.
   */
  AssetContractRecipient: 'asset-contract-recipient',
} as const

export type RecipientRisk = (typeof RECIPIENT_RISK)[keyof typeof RECIPIENT_RISK]

export interface IRecipientRiskOptions {
  /**
   * Contract address of the token or collection being sent.
   *
   * `null` or absence means a native-currency transfer: it has
   * no contract, and there is nothing to check.
   */
  readonly assetContract?: Address | null
}

/**
 * Checks the recipient before sending.
 *
 * THESE ARE WARNINGS, NOT BANS. Each case has a legitimate use:
 * a transfer to oneself between accounts, burning tokens, an
 * address copied from a source without a checksum. A ban would
 * take away the ability to do what they intended; a warning
 * lets them stop and think.
 *
 * WHY EXACTLY THESE CHECKS. Each catches a mistake that cannot
 * be undone after the send: a transfer on the chain is final.
 * Checks that fire often and without use are not added — a false
 * alarm trains people not to read warnings, and a real one would
 * go unnoticed.
 *
 * @param recipient The address AS THE USER TYPED IT.
 *        A normalized value must not be passed here: `toAddress`
 *        brings the writing to checksum form, and the "typed
 *        without a checksum" mark is lost before the check —
 *        the warning would never appear.
 */
export function findRecipientRisks(
  recipient: string,
  sender: Address,
  options: IRecipientRiskOptions = {},
): readonly RecipientRisk[] {
  const risks: RecipientRisk[] = []

  /* This check comes first: it means a certain loss, not a reason
     to think, and must be noticed before the others. */
  if (
    options.assetContract !== undefined &&
    options.assetContract !== null &&
    areAddressesEqual(recipient, options.assetContract)
  ) {
    risks.push(RECIPIENT_RISK.AssetContractRecipient)
  }

  /* Address comparison is case-insensitive, so the raw string
     works for these two checks as well. */
  if (isBurnAddress(recipient)) {
    risks.push(RECIPIENT_RISK.BurnAddress)
  }

  if (areAddressesEqual(recipient, sender)) {
    risks.push(RECIPIENT_RISK.SelfTransfer)
  }

  if (!hasChecksum(recipient)) {
    risks.push(RECIPIENT_RISK.NoChecksum)
  }

  return risks
}

/**
 * Whether the recipient is a contract.
 *
 * THE NODE REQUEST IS SEPARATED FROM THE OTHER CHECKS ON PURPOSE.
 * `findRecipientRisks` is a pure function: it works from the typed
 * string and runs on every keystroke. Talking to the network
 * inside it would mean a request on every typed character.
 *
 * WHAT THE NODE OPERATOR LEARNS. The recipient address — but they
 * will see it in a second when the transaction is published.
 * There is no extra leak here.
 *
 * A NODE FAILURE DOES NOT MEAN "NOT A CONTRACT". `null` is
 * returned, and the UI must say the check could not be done.
 * "Checked, all is well" instead of "could not check" is a
 * claim nobody made.
 *
 * @returns `true` — a contract, `false` — an ordinary address,
 *          `null` — the node did not answer.
 */
export async function isContractAddress(
  address: Address,
  provider: { getCode(address: Address): Promise<string> },
): Promise<boolean | null> {
  try {
    const code = await provider.getCode(address)

    /* Nodes return `0x` for an ordinary address. An empty string
       appears in some implementations and means the same. */
    return code !== '0x' && code !== ''
  } catch {
    return null
  }
}

/**
 * Whether the address is written with an EIP-55 checksum.
 *
 * The checksum is expressed in letter case: an address entirely
 * lowercase or entirely uppercase does not carry it. Such an
 * address is formally valid, but a typo in it is not detected —
 * and a typo in an address means lost funds with no return.
 *
 * An address with no letters (digits only) cannot be told apart
 * from a checksummed one, and is treated as checked: requiring
 * otherwise would warn for no reason.
 */
function hasChecksum(address: string): boolean {
  const body = address.slice(2)
  const letters = body.replace(/[^a-zA-Z]/gu, '')

  if (letters === '') {
    return true
  }

  return letters !== letters.toLowerCase() && letters !== letters.toUpperCase()
}
