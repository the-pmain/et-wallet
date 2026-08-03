export {
  ALLOWANCE_SELECTOR,
  APPROVAL_FOR_ALL_TOPIC,
  APPROVAL_TOPIC,
  APPROVE_SELECTOR,
  ERC20_APPROVAL_TOPIC_COUNT,
  IS_APPROVED_FOR_ALL_SELECTOR,
  SET_APPROVAL_FOR_ALL_SELECTOR,
  encodeAllowance,
  encodeRevokeAllowance,
  encodeRevokeApprovalForAll,
} from './abi'
export { ApprovalService, type IApprovalServiceDependencies } from './ApprovalService'
export type { IApprovalLimits, IApprovalPage, IApprovalRecord } from './types'
