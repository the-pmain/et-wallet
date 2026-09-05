import { describe, expect, it } from 'vitest'

import { DEAD_ADDRESS, toAddress, ZERO_ADDRESS } from '@/core/address'
import type { Address } from '@/core/types'

import { RECIPIENT_RISK, findRecipientRisks } from './risk'

const SENDER = toAddress('0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed')
const PEER = toAddress('0xfB6916095ca1df60bB79Ce92cE3Ea74c37c5d359')

describe('findRecipientRisks', () => {
  it('finds no remarks on an ordinary checksummed address', () => {
    expect(findRecipientRisks(PEER, SENDER)).toHaveLength(0)
  })

  it('warns about a burn address', () => {
    /* The funds leave for good: no one will be able to get them. */
    expect(findRecipientRisks(ZERO_ADDRESS, SENDER)).toContain(RECIPIENT_RISK.BurnAddress)
  })

  it('warns about a transfer to oneself', () => {
    expect(findRecipientRisks(SENDER, SENDER)).toContain(RECIPIENT_RISK.SelfTransfer)
  })

  it('notices a self-transfer regardless of address case', () => {
    const lowercase = SENDER.toLowerCase() as Address

    expect(findRecipientRisks(lowercase, SENDER)).toContain(RECIPIENT_RISK.SelfTransfer)
  })

  it('warns about an address without a checksum', () => {
    /* The checksum is expressed in letter case: an all-lowercase
       address carries none, and a typo is not detected. */
    const lowercase = PEER.toLowerCase() as Address

    expect(findRecipientRisks(lowercase, SENDER)).toContain(RECIPIENT_RISK.NoChecksum)
  })

  it('warns about an all-uppercase address', () => {
    const uppercase = `0x${PEER.slice(2).toUpperCase()}` as Address

    expect(findRecipientRisks(uppercase, SENDER)).toContain(RECIPIENT_RISK.NoChecksum)
  })

  it('does not warn about an all-digit address', () => {
    /* Such an address is indistinguishable from a checksummed one:
       demanding otherwise would warn without cause, and a false
       alarm trains people not to read warnings. */
    const digitsOnly = `0x${'1234567890'.repeat(4)}` as Address

    expect(findRecipientRisks(digitsOnly, SENDER)).not.toContain(RECIPIENT_RISK.NoChecksum)
  })

  it('finds several remarks at once', () => {
    /* The burn address `0x…dEaD` written in lowercase: both funds
       going nowhere and a missing checksum. */
    const risks = findRecipientRisks(DEAD_ADDRESS.toLowerCase(), SENDER)

    expect(risks).toContain(RECIPIENT_RISK.BurnAddress)
    expect(risks).toContain(RECIPIENT_RISK.NoChecksum)
  })
})

describe('Sending an asset to its own contract', () => {
  const TOKEN = toAddress('0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48')

  it('a recipient that matches the token contract is flagged', () => {
    /* The most common irreversible token mistake: the contract
       address is copied from an explorer or the asset list and
       pasted into the recipient field. */
    const risks = findRecipientRisks(TOKEN, SENDER, { assetContract: TOKEN })

    expect(risks).toContain(RECIPIENT_RISK.AssetContractRecipient)
  })

  it('address case does not matter', () => {
    const risks = findRecipientRisks(TOKEN.toLowerCase(), SENDER, { assetContract: TOKEN })

    expect(risks).toContain(RECIPIENT_RISK.AssetContractRecipient)
  })

  it('a different contract does not trigger this remark', () => {
    /* Sending a token to another contract can be lawful: exchanges
       and vaults accept such transfers. */
    const risks = findRecipientRisks(PEER, SENDER, { assetContract: TOKEN })

    expect(risks).not.toContain(RECIPIENT_RISK.AssetContractRecipient)
  })

  it('without asset details the remark does not appear', () => {
    /* A native-currency transfer: it has no contract to compare. */
    const risks = findRecipientRisks(TOKEN, SENDER)

    expect(risks).not.toContain(RECIPIENT_RISK.AssetContractRecipient)
  })

  it('the remark comes first', () => {
    /* It means a certain loss, not a reason to think twice, and
       must be seen before the others: a contract address is not
       always checksummed, and "no checksum" must not rank higher. */
    const risks = findRecipientRisks(TOKEN.toLowerCase(), SENDER, { assetContract: TOKEN })

    expect(risks[0]).toBe(RECIPIENT_RISK.AssetContractRecipient)
  })
})
