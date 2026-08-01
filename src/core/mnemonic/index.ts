export type { IMnemonicService } from './contracts'
export { MnemonicService } from './MnemonicService'
export { normalizeMnemonicInput, splitWords } from './normalize'
export {
  BIP39_SEED_LENGTH,
  MNEMONIC_STRENGTH,
  VALID_WORD_COUNTS,
  type IMnemonicValidationResult,
  type MnemonicStrength,
} from './types'
