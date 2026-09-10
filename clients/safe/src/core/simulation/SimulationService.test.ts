import { describe, expect, it, vi } from 'vitest'

import { ConsoleLogger } from '@/core/platform'
import type { IProvider } from '@/core/provider'
import { SIMULATION_OUTCOME, type ISimulationResult } from '@/core/transaction'
import { toChainId, type Address, type HexString, type Wei } from '@/core/types'

import type { ISimulationSource } from './contracts'
import { SimulationService } from './SimulationService'

const CHAIN_ID = toChainId(1n)

const REQUEST = {
  from: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266' as Address,
  to: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8' as Address,
  data: '0x' as HexString,
  value: 0n as Wei,
}

const logger = new ConsoleLogger()

/** Third-party source reply, distinguishable from the node's. */
const FROM_SOURCE: ISimulationResult = {
  outcome: SIMULATION_OUTCOME.Succeeded,
  gasUsed: 51_000n,
  movements: [],
  reason: null,
}

/**
 * Stand-in node: answers `eth_simulateV1` with a successful call and
 * no events.
 *
 * The reply shape is taken from the real parser in `simulate.ts`:
 * success is `status: '0x1'`, not merely the presence of a reply.
 */
function nodeProvider(): { provider: IProvider; request: ReturnType<typeof vi.fn> } {
  const request = vi.fn(
    () =>
      Promise.resolve([
        { calls: [{ status: '0x1', gasUsed: '0x5208', returnData: '0x', logs: [] }] },
      ]) as Promise<unknown>,
  )

  return { provider: { request } as unknown as IProvider, request }
}

function source(overrides: Partial<ISimulationSource>): ISimulationSource {
  return {
    id: 'test',
    name: 'Test source',
    isAvailable: () => true,
    simulate: () => Promise.resolve(null),
    ...overrides,
  }
}

describe('SimulationService: whom to ask', () => {
  it('asks the node when there are no sources', async () => {
    const service = new SimulationService({ logger })
    const node = nodeProvider()

    const result = await service.simulate(node.provider, REQUEST, CHAIN_ID)

    expect(result.outcome).toBe(SIMULATION_OUTCOME.Succeeded)
    expect(node.request).toHaveBeenCalled()
  })

  it('a source answers before the node', async () => {
    const node = nodeProvider()
    const service = new SimulationService({
      logger,
      sources: [source({ simulate: () => Promise.resolve(FROM_SOURCE) })],
    })

    const result = await service.simulate(node.provider, REQUEST, CHAIN_ID)

    expect(result.gasUsed).toBe(51_000n)
    expect(node.request).not.toHaveBeenCalled()
  })

  it('source silence is passed to the node', async () => {
    /* THE MAIN PROPERTY OF THE SERVICE. A source that did not parse
       the reply must yield: otherwise its silence would reach the
       screen as "could not check" while the node is fully working. */
    const node = nodeProvider()
    const service = new SimulationService({
      logger,
      sources: [source({ simulate: () => Promise.resolve(null) })],
    })

    const result = await service.simulate(node.provider, REQUEST, CHAIN_ID)

    expect(result.outcome).toBe(SIMULATION_OUTCOME.Succeeded)
    expect(node.request).toHaveBeenCalled()
  })

  it('a source exception is equivalent to silence', async () => {
    const node = nodeProvider()
    const service = new SimulationService({
      logger,
      sources: [source({ simulate: () => Promise.reject(new Error('network unavailable')) })],
    })

    const result = await service.simulate(node.provider, REQUEST, CHAIN_ID)

    expect(result.outcome).toBe(SIMULATION_OUTCOME.Succeeded)
    expect(node.request).toHaveBeenCalled()
  })

  it('an unconfigured source is not asked at all', async () => {
    const simulate = vi.fn(() => Promise.resolve(FROM_SOURCE))
    const service = new SimulationService({
      logger,
      sources: [source({ isAvailable: () => false, simulate })],
    })

    await service.simulate(nodeProvider().provider, REQUEST, CHAIN_ID)

    expect(simulate).not.toHaveBeenCalled()
  })

  it('a node refusal does not throw, it becomes an outcome', async () => {
    /* A check refusal must not abort transaction preparation: the
       person would then see neither the consequences nor the form. */
    const provider = {
      request: vi.fn(() => Promise.reject(new Error('the node did not respond'))),
    } as unknown as IProvider

    const service = new SimulationService({ logger })
    const result = await service.simulate(provider, REQUEST, CHAIN_ID)

    expect(result.outcome).toBe(SIMULATION_OUTCOME.Unavailable)
    expect(result.movements).toHaveLength(0)
  })

  it('names the source that will be asked first', async () => {
    expect(new SimulationService({ logger }).activeSourceName()).toBeNull()

    const service = new SimulationService({ logger, sources: [source({})] })

    expect(service.activeSourceName()).toBe('Test source')

    await Promise.resolve()
  })
})
