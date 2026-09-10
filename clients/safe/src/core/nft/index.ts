/* Encoding primitives live in `core/abi`: they are the same for any
   contract. They are re-exported here so item-module consumers do
   not know about two sources. */
export {
  decodeAddress,
  decodeBool,
  encodeAddressWord,
  encodeCallWithAddressAndUint,
  encodeCallWithUint,
  encodeUintWord,
} from '@/core/abi'
export {
  ERC1155_BALANCE_OF_SELECTOR,
  OWNER_OF_SELECTOR,
  SAFE_TRANSFER_1155_SELECTOR,
  SAFE_TRANSFER_721_SELECTOR,
  SUPPORTS_INTERFACE_SELECTOR,
  TOKEN_URI_SELECTOR,
  decodeSafeTransferRecipient,
  encodeSafeTransfer1155,
  encodeSafeTransfer721,
  encodeSupportsInterface,
} from './abi'
export { NftService, type INftServiceDependencies } from './NftService'
export type { INftItem, INftLimits, INftPage } from './types'
