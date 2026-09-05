/**
 * Frozen data for the theme studies.
 *
 * Variant pages do not read the session or hit the network: comparison
 * must sit on the same slice, or a difference in amounts would read as
 * a difference in themes.
 */
export const VARIANT_ACCOUNT = {
  name: 'Account 1',
  walletName: 'Main Wallet',
  displayName: 'James',
  email: 'james@etwallet.local',
  address: '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed',
  shortAddress: '0x5aAe…eAed',
  network: 'Ethereum',
} as const

export const VARIANT_BALANCE = {
  eth: '1.5',
  fiat: '$4,280.50',
  fiatWhole: '4,280',
  fiatCents: '50',
  change: '+2.14%',
  changeAmount: '+$89.20',
} as const

export interface IVariantToken {
  readonly symbol: string
  readonly name: string
  readonly amount: string
  readonly fiat: string
  readonly change: string
  readonly tone: 'eth' | 'usdc' | 'usdt'
  readonly isUp: boolean
}

export const VARIANT_TOKENS: readonly IVariantToken[] = [
  {
    symbol: 'ETH',
    name: 'Ethereum',
    amount: '1.5',
    fiat: '$4,102.50',
    change: '+1.8%',
    tone: 'eth',
    isUp: true,
  },
  {
    symbol: 'USDC',
    name: 'USD Coin',
    amount: '128.00',
    fiat: '$128.00',
    change: '0.0%',
    tone: 'usdc',
    isUp: true,
  },
  {
    symbol: 'USDT',
    name: 'Tether',
    amount: '50.00',
    fiat: '$50.00',
    change: '−0.1%',
    tone: 'usdt',
    isUp: false,
  },
]

export interface IVariantSending {
  readonly id: string
  readonly title: string
  readonly detail: string
  readonly amount: string
  readonly when: string
  readonly direction: 'out' | 'in'
}

export const VARIANT_SENDINGS: readonly IVariantSending[] = [
  {
    id: 's1',
    title: 'Sent ETH',
    detail: 'To 0x9eb8…3459',
    amount: '−0.20 ETH',
    when: 'Today, 11:42',
    direction: 'out',
  },
  {
    id: 's2',
    title: 'Received USDC',
    detail: 'From exchange wallet',
    amount: '+$200.00',
    when: 'Yesterday',
    direction: 'in',
  },
  {
    id: 's3',
    title: 'Sent USDT',
    detail: 'To 0x6dAD…131A',
    amount: '−50.00 USDT',
    when: 'Mon',
    direction: 'out',
  },
]
