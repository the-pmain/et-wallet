import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { toAddress, toChainId, type Timestamp } from '@/core'

import type { ITokenBalance } from '../model/contracts'
import { SendAssetSelect } from './SendAssetSelect'

const NOW = 1_785_000_000_000 as Timestamp

const ETH: ITokenBalance = {
  token: {
    chainId: toChainId(1),
    address: null,
    standard: 'native',
    symbol: 'ETH',
    name: 'Ether',
    decimals: 18,
    logoUri: null,
    isVerified: true,
    isCustom: false,
    addedAt: NOW,
  },
  balance: 1_284_700_000_000_000_000n,
}

const USDC: ITokenBalance = {
  token: {
    chainId: toChainId(1),
    address: toAddress('0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'),
    standard: 'ERC-20',
    symbol: 'USDC',
    name: 'USD Coin',
    decimals: 6,
    logoUri: null,
    isVerified: true,
    isCustom: false,
    addedAt: NOW,
  },
  balance: 2_500_000_000n,
}

describe('SendAssetSelect', () => {
  it('открывает список по нажатию и показывает знак в каждой строке', async () => {
    const user = userEvent.setup()
    render(
      <SendAssetSelect
        id="asset"
        assets={[ETH, USDC]}
        value={null}
        onChange={() => undefined}
      />,
    )

    await user.click(screen.getByRole('combobox'))

    const eth = screen.getByRole('option', { name: /Select ETH on Ethereum/ })
    const usdc = screen.getByRole('option', { name: /Select USDC on Ethereum/ })

    expect(eth.querySelector('img')).not.toBeNull()
    expect(usdc.querySelector('img')).not.toBeNull()
    expect(eth.querySelector('img')?.getAttribute('src')).toBe('/logos/eth.svg')
    expect(usdc.querySelector('img')?.getAttribute('src')).toBe('/logos/usdc.svg')
  })

  it('передаёт выбранный актив и закрывает список', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(
      <SendAssetSelect
        id="asset"
        assets={[ETH, USDC]}
        value={null}
        onChange={onChange}
      />,
    )

    await user.click(screen.getByRole('combobox'))
    await user.click(screen.getByRole('option', { name: /Select USDC on Ethereum/ }))

    expect(onChange).toHaveBeenCalledWith(USDC.token.address)
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('помечает выбранный актив галочкой', async () => {
    const user = userEvent.setup()
    render(
      <SendAssetSelect
        id="asset"
        assets={[ETH, USDC]}
        value={USDC.token.address}
        onChange={() => undefined}
      />,
    )

    await user.click(screen.getByRole('combobox'))

    const selected = screen.getByRole('option', { name: /Select USDC on Ethereum/ })
    expect(selected).toHaveAttribute('aria-selected', 'true')
  })
})
