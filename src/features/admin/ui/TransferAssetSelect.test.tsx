import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { ADDABLE_ASSETS } from '../model/addable-assets'

import { defaultTransferAsset, TransferAssetSelect } from './TransferAssetSelect'

describe('TransferAssetSelect', () => {
  it('opens the list on click and shows a mark in each visible row', async () => {
    const user = userEvent.setup()
    render(
      <TransferAssetSelect
        id="asset"
        value={defaultTransferAsset().id}
        onChange={() => undefined}
      />,
    )

    await user.click(screen.getByRole('combobox'))

    const eth = screen.getByRole('option', { name: 'Select ETH on Ethereum' })
    const usdc = screen.getByRole('option', { name: 'Select USDC on Ethereum' })

    expect(eth.querySelector('img')?.getAttribute('src')).toBe('/logos/eth.svg')
    expect(usdc.querySelector('img')?.getAttribute('src')).toBe('/logos/usdc.svg')
    expect(screen.getByRole('listbox').querySelectorAll('[role="option"]').length).toBe(
      ADDABLE_ASSETS.length,
    )
  })

  it('filters the list when searching', async () => {
    const user = userEvent.setup()
    render(
      <TransferAssetSelect
        id="asset"
        value={defaultTransferAsset().id}
        onChange={() => undefined}
      />,
    )

    await user.click(screen.getByRole('combobox'))
    await user.type(screen.getByLabelText('Search cryptocurrencies'), 'usdt')

    expect(screen.getByRole('option', { name: 'Select USDT on Ethereum' })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: 'Select ETH on Ethereum' })).not.toBeInTheDocument()
  })

  it('passes the chosen coin and closes the list', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(
      <TransferAssetSelect
        id="asset"
        value={defaultTransferAsset().id}
        onChange={onChange}
      />,
    )

    await user.click(screen.getByRole('combobox'))
    await user.click(screen.getByRole('option', { name: 'Select USDT on Ethereum' }))

    expect(onChange).toHaveBeenCalledOnce()
    expect(onChange.mock.calls[0]?.[0]).toMatchObject({
      chainName: 'Ethereum',
      token: { symbol: 'USDT' },
    })
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('marks the selected asset with a check', async () => {
    const user = userEvent.setup()
    const usdc = ADDABLE_ASSETS.find(
      (item) => item.token.symbol === 'USDC' && item.chainName === 'Ethereum',
    )

    expect(usdc).toBeDefined()

    render(
      <TransferAssetSelect id="asset" value={usdc?.id ?? ''} onChange={() => undefined} />,
    )

    await user.click(screen.getByRole('combobox'))

    expect(screen.getByRole('option', { name: 'Select USDC on Ethereum' })).toHaveAttribute(
      'aria-selected',
      'true',
    )
  })
})
