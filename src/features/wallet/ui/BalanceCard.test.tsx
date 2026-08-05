import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { toWei, type IBalance, type INetworkConfig } from '@/core'
import { I18nProvider } from '@/app/providers/I18nProvider'

import { BalanceCard } from './BalanceCard'

const NETWORK = {
  chainId: 1n,
  name: 'Ethereum',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: [],
  blockExplorerUrls: [],
  isTestnet: false,
  isBuiltIn: true,
  supportsEip1559: true,
} as unknown as INetworkConfig

function balanceOf(raw: bigint): IBalance {
  return { raw: toWei(raw), decimals: 18, isStale: false } as unknown as IBalance
}

function renderCard(balance: IBalance | null, isLoading = false) {
  return render(
    <I18nProvider>
      <BalanceCard
        balance={balance}
        network={NETWORK}
        isLoading={isLoading}
        error={null}
        onRefresh={() => undefined}
      />
    </I18nProvider>,
  )
}

/** Узел с самой суммой: он один несёт табличные цифры крупным кеглем. */
function amountNode(): HTMLElement {
  return document.querySelector('[data-slot=card-content] p.tabular-nums') as HTMLElement
}

/**
 * Движение суммы означает ПРИХОД ДРУГОГО ЗНАЧЕНИЯ.
 *
 * Проверяется тестом, а не глазами: браузерная панель предпросмотра
 * в этой среде не рисует кадров, и анимация в ней всегда стоит на нуле.
 * Наличие или отсутствие классов появления — то, что можно утверждать
 * достоверно.
 */
describe('BalanceCard: появление суммы', () => {
  it('при первом показе не анимируется', () => {
    renderCard(balanceOf(5n))

    /* Экран в этот момент уже появляется целиком. Второй вход на самом
       крупном объекте поверх первого читается как рябь. */
    expect(amountNode().className).not.toContain('animate-in')
  })

  it('анимируется, когда пришло другое значение', () => {
    const view = renderCard(balanceOf(5n))

    view.rerender(
      <I18nProvider>
        <BalanceCard
          balance={balanceOf(7n)}
          network={NETWORK}
          isLoading={false}
          error={null}
          onRefresh={() => undefined}
        />
      </I18nProvider>,
    )

    expect(amountNode().className).toContain('animate-in')
  })

  it('не анимируется, когда сумма прежняя', () => {
    const view = renderCard(balanceOf(5n))

    /* Сессия пересоздаёт объект баланса при каждом обновлении.
       Сравнивается значение, а не ссылка, иначе рябь шла бы на каждый
       опрос узла. */
    view.rerender(
      <I18nProvider>
        <BalanceCard
          balance={balanceOf(5n)}
          network={NETWORK}
          isLoading={false}
          error={null}
          onRefresh={() => undefined}
        />
      </I18nProvider>,
    )

    expect(amountNode().className).not.toContain('animate-in')
  })

  it('помечает область занятой, пока сумма обновляется', () => {
    renderCard(balanceOf(5n), true)

    /* Вращение значка — единственный признак работы для зрячего;
       для слушающего страницу им служит эта пометка. */
    const content = document.querySelector('[data-slot=card-content]')

    expect(content?.getAttribute('aria-busy')).toBe('true')
    expect(screen.getByLabelText('Refresh the balance')).toBeDisabled()
  })
})
