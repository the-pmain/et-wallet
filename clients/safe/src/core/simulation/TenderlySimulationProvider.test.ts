import { describe, expect, it } from 'vitest'

import { MOVEMENT_KIND, SIMULATION_OUTCOME } from '@/core/transaction'

import { parseSimulation } from './TenderlySimulationProvider'

const USDC = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'
const ALICE = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266'
const BOB = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8'

/** Reply for a successful transaction with one balance change. */
function succeeded(changes: unknown): unknown {
  return {
    simulation: { status: true, gas_used: 51_000 },
    transaction: { transaction_info: { asset_changes: changes } },
  }
}

describe('parseSimulation: silence instead of a guess', () => {
  it('parses a token transfer', () => {
    const result = parseSimulation(
      succeeded([
        {
          from: ALICE,
          to: BOB,
          raw_amount: '1500000',
          token_info: { standard: 'ERC20', contract_address: USDC },
        },
      ]),
    )

    expect(result?.outcome).toBe(SIMULATION_OUTCOME.Succeeded)
    expect(result?.gasUsed).toBe(51_000n)
    expect(result?.movements).toHaveLength(1)
    expect(result?.movements[0]?.kind).toBe(MOVEMENT_KIND.Erc20)
    expect(result?.movements[0]?.amount).toBe(1_500_000n)
  })

  it('treats a change without a contract address as native currency', () => {
    const result = parseSimulation(
      succeeded([{ from: ALICE, to: BOB, raw_amount: '1000000000000000000' }]),
    )

    expect(result?.movements[0]?.kind).toBe(MOVEMENT_KIND.Native)
    expect(result?.movements[0]?.contract).toBeNull()
  })

  it('an empty change list is a lawful reply', () => {
    /* A transaction that moves nothing exists: an allowance
       approval changes a permit, not a balance. */
    const result = parseSimulation(succeeded([]))

    expect(result?.outcome).toBe(SIMULATION_OUTCOME.Succeeded)
    expect(result?.movements).toHaveLength(0)
  })

  it('ABSENCE of a change list is silence, not emptiness', () => {
    /* THE MAIN CHECK OF THE MODULE. A parse that returned
       "succeeded, no movements" where the field simply did not
       arrive would show the owner a safety confirmation of a call
       that empties the wallet. */
    expect(parseSimulation(succeeded(undefined))).toBeNull()
    expect(parseSimulation({ simulation: { status: true } })).toBeNull()
    expect(parseSimulation({ simulation: { status: true }, transaction: {} })).toBeNull()
  })

  it('an unrecognised change cancels the whole reply', () => {
    /* Skipping one unrecognised row would show an incomplete list
       as complete. Better to yield to the node entirely. */
    const result = parseSimulation(
      succeeded([
        {
          from: ALICE,
          to: BOB,
          raw_amount: '1',
          token_info: { standard: 'ERC20', contract_address: USDC },
        },
        {
          from: ALICE,
          to: BOB,
          raw_amount: '2',
          token_info: { standard: 'ERC-UNKNOWN', contract_address: USDC },
        },
      ]),
    )

    expect(result).toBeNull()
  })

  it('a revert is parsed together with the reason', () => {
    const result = parseSimulation({
      simulation: { status: false, gas_used: 21_000, error_message: 'execution reverted: EXPIRED' },
    })

    expect(result?.outcome).toBe(SIMULATION_OUTCOME.Reverted)
    expect(result?.reason).toBe('execution reverted: EXPIRED')

    /* On revert an empty list means exactly "nothing will happen",
       not "could not parse": the transaction will not occur at all. */
    expect(result?.movements).toHaveLength(0)
  })

  it('a reply without a success flag is not parsed', () => {
    expect(parseSimulation({})).toBeNull()
    expect(parseSimulation(null)).toBeNull()
    expect(parseSimulation({ simulation: {} })).toBeNull()
    expect(parseSimulation({ simulation: { status: 'true' } })).toBeNull()
  })

  it('an unreadable amount is not replaced with zero', () => {
    /* Zero in place of an unknown amount is an assertion the
       simulation did not make. The movement itself is known and is
       shown. */
    const result = parseSimulation(
      succeeded([
        {
          from: ALICE,
          to: BOB,
          token_info: { standard: 'ERC20', contract_address: USDC },
        },
      ]),
    )

    expect(result?.movements[0]?.amount).toBeNull()
  })
})
