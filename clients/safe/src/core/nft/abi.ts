import {
  SELECTOR_LENGTH,
  WORD_LENGTH,
  encodeAddressWord,
  encodeUintWord,
  functionSelector,
  readAddressWord,
  strip,
} from '@/core/abi'
import type { Address, HexString } from '@/core/types'

/**
 * Encoding of collectible-contract calls.
 *
 * WHY PRIMITIVES ARE TAKEN FROM THE TOKEN MODULE. `functionSelector`,
 * `decodeUint`, and `decodeString` describe ABI encoding, not the
 * ERC-20 standard: they are the same for any contract. A copy here
 * would mean two places for the same encoding, and they would
 * diverge on the first edit.
 *
 * ONLY WHAT THAT MODULE DOES NOT HAVE LIVES HERE: numeric arguments
 * and multi-argument calls. ERC-20 has no such calls.
 */

export const OWNER_OF_SELECTOR = functionSelector('ownerOf(uint256)')

export const TOKEN_URI_SELECTOR = functionSelector('tokenURI(uint256)')

export const ERC1155_BALANCE_OF_SELECTOR = functionSelector('balanceOf(address,uint256)')

export const SUPPORTS_INTERFACE_SELECTOR = functionSelector('supportsInterface(bytes4)')

export const SAFE_TRANSFER_721_SELECTOR = functionSelector(
  'safeTransferFrom(address,address,uint256)',
)

export const SAFE_TRANSFER_1155_SELECTOR = functionSelector(
  'safeTransferFrom(address,address,uint256,uint256,bytes)',
)

/**
 * Encodes a `supportsInterface(bytes4)` call.
 *
 * A `bytes4` argument is padded to the RIGHT of the word start,
 * unlike numbers and addresses: short byte types are zero-padded
 * on the right. Mixed-up padding calls a different interface and
 * silently yields "not supported".
 */
export function encodeSupportsInterface(interfaceId: string): HexString {
  const id = interfaceId.startsWith('0x') ? interfaceId.slice(2) : interfaceId

  return `0x${SUPPORTS_INTERFACE_SELECTOR}${id.padEnd(WORD_LENGTH, '0')}` as HexString
}

/**
 * Encodes an ERC-721 item transfer.
 *
 * THE SAFE VARIANT IS USED. Plain `transferFrom` sends the item to
 * any address, including a contract that cannot accept it: the item
 * stays there forever. `safeTransferFrom` asks the recipient
 * contract for confirmation and reverts if there is none. Sending
 * to an ordinary address is not made harder by that.
 */
export function encodeSafeTransfer721(from: Address, to: Address, tokenId: bigint): HexString {
  return `0x${SAFE_TRANSFER_721_SELECTOR}${encodeAddressWord(from)}${encodeAddressWord(to)}${encodeUintWord(tokenId)}` as HexString
}

/**
 * Encodes an ERC-1155 item transfer.
 *
 * THE LAST ARGUMENT IS VARIABLE-LENGTH BYTES, and is encoded
 * differently from the rest: its slot holds an offset to the data,
 * and the data itself sits at the end. The wallet passes an empty
 * string — it tells the recipient nothing extra.
 *
 * The offset is one hundred and sixty bytes: five words before it
 * are sender, recipient, id, amount, and the offset itself.
 */
export function encodeSafeTransfer1155(
  from: Address,
  to: Address,
  tokenId: bigint,
  amount: bigint,
): HexString {
  const dataOffset = encodeUintWord(160n)
  const emptyData = encodeUintWord(0n)

  return `0x${SAFE_TRANSFER_1155_SELECTOR}${encodeAddressWord(from)}${encodeAddressWord(to)}${encodeUintWord(tokenId)}${encodeUintWord(amount)}${dataOffset}${emptyData}` as HexString
}

/**
 * Reads the recipient from safe-transfer call data.
 *
 * WHY READ BACK WHAT WE ASSEMBLED. The confirmation screen must
 * show the contents of the transaction being signed, not the form
 * field values: then the match between what is shown and what is
 * signed follows from how the screen is built.
 *
 * The recipient's position is the same in both standards: the
 * second word after the selector. They differ further on — id
 * and amount.
 *
 * @returns `null` if the data is not a safe transfer.
 */
export function decodeSafeTransferRecipient(data: HexString): Address | null {
  const body = strip(data)
  const selector = body.slice(0, SELECTOR_LENGTH)

  if (selector !== SAFE_TRANSFER_721_SELECTOR && selector !== SAFE_TRANSFER_1155_SELECTOR) {
    return null
  }

  /* Second word after the selector: in both standards the recipient
     sits there. They differ further on — id and amount. */
  return readAddressWord(
    body.slice(SELECTOR_LENGTH + WORD_LENGTH, SELECTOR_LENGTH + WORD_LENGTH * 2),
  )
}
