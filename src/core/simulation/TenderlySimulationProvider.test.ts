import { describe, expect, it } from 'vitest'

import { MOVEMENT_KIND, SIMULATION_OUTCOME } from '@/core/transaction'

import { parseSimulation } from './TenderlySimulationProvider'

const USDC = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'
const ALICE = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266'
const BOB = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8'

/** Ответ об успешной транзакции с одним изменением баланса. */
function succeeded(changes: unknown): unknown {
  return {
    simulation: { status: true, gas_used: 51_000 },
    transaction: { transaction_info: { asset_changes: changes } },
  }
}

describe('parseSimulation: молчание вместо догадки', () => {
  it('разбирает перевод токена', () => {
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

  it('изменение без адреса контракта считает нативной валютой', () => {
    const result = parseSimulation(
      succeeded([{ from: ALICE, to: BOB, raw_amount: '1000000000000000000' }]),
    )

    expect(result?.movements[0]?.kind).toBe(MOVEMENT_KIND.Native)
    expect(result?.movements[0]?.contract).toBeNull()
  })

  it('пустой перечень изменений — законный ответ', () => {
    /* Транзакция, которая ничего не двигает, существует: одобрение
       расходования средств меняет разрешение, а не баланс. */
    const result = parseSimulation(succeeded([]))

    expect(result?.outcome).toBe(SIMULATION_OUTCOME.Succeeded)
    expect(result?.movements).toHaveLength(0)
  })

  it('ОТСУТСТВИЕ перечня изменений — молчание, а не пустота', () => {
    /* ГЛАВНАЯ ПРОВЕРКА МОДУЛЯ. Разбор, вернувший «выполнено, перемещений
       нет» там, где поля просто не пришло, показал бы владельцу
       подтверждение безопасности вызова, который выносит кошелёк. */
    expect(parseSimulation(succeeded(undefined))).toBeNull()
    expect(parseSimulation({ simulation: { status: true } })).toBeNull()
    expect(parseSimulation({ simulation: { status: true }, transaction: {} })).toBeNull()
  })

  it('непонятое изменение отменяет весь ответ', () => {
    /* Пропустить одну непонятую строку значило бы показать неполный
       перечень как полный. Лучше уступить узлу целиком. */
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
          token_info: { standard: 'ERC-НЕИЗВЕСТНО', contract_address: USDC },
        },
      ]),
    )

    expect(result).toBeNull()
  })

  it('откат разбирается вместе с причиной', () => {
    const result = parseSimulation({
      simulation: { status: false, gas_used: 21_000, error_message: 'execution reverted: EXPIRED' },
    })

    expect(result?.outcome).toBe(SIMULATION_OUTCOME.Reverted)
    expect(result?.reason).toBe('execution reverted: EXPIRED')

    /* При откате пустой перечень означает именно «ничего не произойдёт»,
       а не «разобрать не удалось»: транзакция не состоится вовсе. */
    expect(result?.movements).toHaveLength(0)
  })

  it('ответ без признака успеха не разбирается', () => {
    expect(parseSimulation({})).toBeNull()
    expect(parseSimulation(null)).toBeNull()
    expect(parseSimulation({ simulation: {} })).toBeNull()
    expect(parseSimulation({ simulation: { status: 'true' } })).toBeNull()
  })

  it('нечитаемое количество не подменяется нулём', () => {
    /* Ноль на месте неизвестной суммы — утверждение, которого симуляция
       не делала. Само перемещение при этом известно и показывается. */
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
