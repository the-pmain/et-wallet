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

/** Ответ стороннего источника, отличимый от ответа узла. */
const FROM_SOURCE: ISimulationResult = {
  outcome: SIMULATION_OUTCOME.Succeeded,
  gasUsed: 51_000n,
  movements: [],
  reason: null,
}

/**
 * Узел-дублёр: отвечает на `eth_simulateV1` успешным вызовом без событий.
 *
 * Форма ответа взята из настоящего разбора в `simulate.ts`: успех — это
 * `status: '0x1'`, а не просто наличие ответа.
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
    name: 'Тестовый источник',
    isAvailable: () => true,
    simulate: () => Promise.resolve(null),
    ...overrides,
  }
}

describe('SimulationService: кого спрашивать', () => {
  it('без источников спрашивает узел', async () => {
    const service = new SimulationService({ logger })
    const node = nodeProvider()

    const result = await service.simulate(node.provider, REQUEST, CHAIN_ID)

    expect(result.outcome).toBe(SIMULATION_OUTCOME.Succeeded)
    expect(node.request).toHaveBeenCalled()
  })

  it('источник отвечает раньше узла', async () => {
    const node = nodeProvider()
    const service = new SimulationService({
      logger,
      sources: [source({ simulate: () => Promise.resolve(FROM_SOURCE) })],
    })

    const result = await service.simulate(node.provider, REQUEST, CHAIN_ID)

    expect(result.gasUsed).toBe(51_000n)
    expect(node.request).not.toHaveBeenCalled()
  })

  it('молчание источника передаётся узлу', async () => {
    /* ГЛАВНОЕ СВОЙСТВО СЛУЖБЫ. Источник, не разобравший ответ, обязан
       уступить: иначе его молчание дошло бы до экрана как «проверить
       не удалось» при полностью работоспособном узле. */
    const node = nodeProvider()
    const service = new SimulationService({
      logger,
      sources: [source({ simulate: () => Promise.resolve(null) })],
    })

    const result = await service.simulate(node.provider, REQUEST, CHAIN_ID)

    expect(result.outcome).toBe(SIMULATION_OUTCOME.Succeeded)
    expect(node.request).toHaveBeenCalled()
  })

  it('исключение источника равносильно молчанию', async () => {
    const node = nodeProvider()
    const service = new SimulationService({
      logger,
      sources: [source({ simulate: () => Promise.reject(new Error('сеть недоступна')) })],
    })

    const result = await service.simulate(node.provider, REQUEST, CHAIN_ID)

    expect(result.outcome).toBe(SIMULATION_OUTCOME.Succeeded)
    expect(node.request).toHaveBeenCalled()
  })

  it('ненастроенный источник не спрашивается вовсе', async () => {
    const simulate = vi.fn(() => Promise.resolve(FROM_SOURCE))
    const service = new SimulationService({
      logger,
      sources: [source({ isAvailable: () => false, simulate })],
    })

    await service.simulate(nodeProvider().provider, REQUEST, CHAIN_ID)

    expect(simulate).not.toHaveBeenCalled()
  })

  it('отказ узла не бросает исключение, а становится исходом', async () => {
    /* Отказ проверки не может срывать подготовку транзакции: человек
       тогда не увидел бы ни следствий, ни формы. */
    const provider = {
      request: vi.fn(() => Promise.reject(new Error('узел не ответил'))),
    } as unknown as IProvider

    const service = new SimulationService({ logger })
    const result = await service.simulate(provider, REQUEST, CHAIN_ID)

    expect(result.outcome).toBe(SIMULATION_OUTCOME.Unavailable)
    expect(result.movements).toHaveLength(0)
  })

  it('называет источник, который будет спрошен первым', async () => {
    expect(new SimulationService({ logger }).activeSourceName()).toBeNull()

    const service = new SimulationService({ logger, sources: [source({})] })

    expect(service.activeSourceName()).toBe('Тестовый источник')

    await Promise.resolve()
  })
})
