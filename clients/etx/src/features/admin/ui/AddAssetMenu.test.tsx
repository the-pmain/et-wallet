import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { AddAssetMenu } from './AddAssetMenu'

const ETH = {
  chainId: '1',
  standard: 'native' as const,
  address: null,
  symbol: 'ETH',
  name: 'Ether',
  decimals: 18,
  balance: '0',
  isVerified: true,
}

describe('AddAssetMenu', () => {
  it('открывает список по нажатию и держит знак в каждой строке', async () => {
    const user = userEvent.setup()
    render(<AddAssetMenu existing={[]} disabled={false} onAdd={() => undefined} />)

    expect(screen.queryByRole('menu')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Add crypto' }))

    const menu = screen.getByRole('menu', { name: 'Cryptocurrencies' })
    const eth = screen.getByRole('menuitem', { name: 'Add ETH on Ethereum' })
    const usdc = screen.getByRole('menuitem', { name: 'Add USDC on Ethereum' })

    expect(eth.querySelector('img')).not.toBeNull()
    expect(usdc.querySelector('img')).not.toBeNull()
    expect(eth.querySelector('img')?.getAttribute('src')).toBe('/logos/eth.svg')
    expect(usdc.querySelector('img')?.getAttribute('src')).toBe('/logos/usdc.svg')
    expect(menu.querySelectorAll('[role="menuitem"]').length).toBeGreaterThan(8)
  })

  it('передаёт выбранную монету и закрывает список', async () => {
    const user = userEvent.setup()
    const onAdd = vi.fn()
    render(<AddAssetMenu existing={[]} disabled={false} onAdd={onAdd} />)

    await user.click(screen.getByRole('button', { name: 'Add crypto' }))
    await user.click(screen.getByRole('menuitem', { name: 'Add USDT on Ethereum' }))

    expect(onAdd).toHaveBeenCalledOnce()
    expect(onAdd.mock.calls[0]?.[0]).toMatchObject({
      chainId: '1',
      symbol: 'USDT',
      standard: 'ERC-20',
      balance: '0',
    })
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('не даёт добавить уже лежащую в витрине монету', async () => {
    const user = userEvent.setup()
    const onAdd = vi.fn()
    render(<AddAssetMenu existing={[ETH]} disabled={false} onAdd={onAdd} />)

    await user.click(screen.getByRole('button', { name: 'Add crypto' }))

    const eth = screen.getByRole('menuitem', { name: 'ETH on Ethereum already added' })
    expect(eth).toBeDisabled()

    await user.click(eth)
    expect(onAdd).not.toHaveBeenCalled()
  })

  it('закрывает список по второму нажатию на кнопку', async () => {
    const user = userEvent.setup()
    render(<AddAssetMenu existing={[]} disabled={false} onAdd={() => undefined} />)

    await user.click(screen.getByRole('button', { name: 'Add crypto' }))
    expect(screen.getByRole('menu')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Add crypto' }))
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })
})
