import { eventTopic } from '@/core/abi'
import { toAddress } from '@/core/address'
import type { Address, HexString } from '@/core/types'

/**
 * `Transfer(address,address,uint256)`.
 *
 * Shared event of ERC-20 and ERC-721. They differ in the number of
 * indexed parameters: ERC-20 indexes sender and recipient (three
 * topics together with the event id), ERC-721 also indexes
 * `tokenId` (four topics). That is the only reliable mark —
 * the event itself does not name the type.
 */
export const TRANSFER_TOPIC = eventTopic('Transfer(address,address,uint256)')

export const TRANSFER_SINGLE_TOPIC = eventTopic(
  'TransferSingle(address,address,address,uint256,uint256)',
)

export const TRANSFER_BATCH_TOPIC = eventTopic(
  'TransferBatch(address,address,address,uint256[],uint256[])',
)

/** Topic length: 32 bytes in hex plus the prefix. */
const TOPIC_LENGTH = 66

/**
 * Encodes an address as a log topic.
 *
 * An address is 20 bytes, a topic is 32, so the value is left-padded
 * with zeros. Case is lowercased: the node compares topics byte for
 * byte, and an EIP-55 checksum writing would match nothing.
 */
export function addressToTopic(address: Address): HexString {
  return `0x${address.slice(2).toLowerCase().padStart(64, '0')}` as HexString
}

/**
 * Extracts an address from a log topic.
 *
 * @throws InvalidAddressError if the topic does not hold a valid address.
 */
export function topicToAddress(topic: HexString): Address {
  if (topic.length !== TOPIC_LENGTH) {
    throw new Error(`The log topic has a wrong length: ${String(topic.length)}`)
  }

  /* The address is the last 20 bytes of the topic, i.e. the last 40 characters. */
  return toAddress(`0x${topic.slice(-40)}`)
}

/**
 * Reads an unsigned integer from a hex string.
 *
 * An empty string and a lone prefix mean zero: nodes return `0x`
 * for empty data, and `BigInt('0x')` throws on that.
 */
export function hexToBigInt(value: string): bigint {
  return value === '' || value === '0x' ? 0n : BigInt(value)
}

/**
 * Splits a log `data` field into 32-byte words.
 *
 * Every value in a log is aligned to 32 bytes regardless of the
 * declared type — that is how ABI encoding works.
 */
export function splitDataWords(data: HexString): readonly bigint[] {
  const body = data.startsWith('0x') ? data.slice(2) : data
  const words: bigint[] = []

  for (let offset = 0; offset + 64 <= body.length; offset += 64) {
    words.push(hexToBigInt(`0x${body.slice(offset, offset + 64)}`))
  }

  return words
}
