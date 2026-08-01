import type { IRpcEntry } from './types.ts'

/**
 * Каталог рекомендуемых RPC-адресов.
 *
 * ЧТО ОЗНАЧАЕТ «РЕКОМЕНДУЕМЫЙ». Что адрес обслуживает заявленную сеть
 * и доступен из браузера. Ничего о приватности это не обещает: оператор
 * общедоступного узла видит IP-адрес пользователя и все его обращения —
 * какие адреса проверяются, какие контракты вызываются и когда. Этого
 * достаточно, чтобы связать личность с портфелем.
 *
 * Поэтому каждая запись несёт имя оператора и признак общедоступности:
 * «работает» и «работает через стороннего оператора, видящего все ваши
 * адреса» — разные утверждения, и выбирать между ними вправе только
 * пользователь.
 *
 * УЗЛЫ, ТРЕБУЮЩИЕ КЛЮЧА, СЮДА НЕ ВНОСЯТСЯ. Ключ, розданный всем
 * пользователям, перестаёт быть ключом, а сервис, раздающий чужие
 * ключи, берёт на себя чужие лимиты и чужую ответственность.
 */
export const RPC_ENDPOINTS: readonly IRpcEntry[] = [
  {
    chainId: 1n,
    url: 'https://ethereum-rpc.publicnode.com',
    operator: 'PublicNode',
    isPublic: true,
  },
  { chainId: 1n, url: 'https://eth.llamarpc.com', operator: 'LlamaNodes', isPublic: true },
  { chainId: 1n, url: 'https://cloudflare-eth.com', operator: 'Cloudflare', isPublic: true },

  { chainId: 56n, url: 'https://bsc-rpc.publicnode.com', operator: 'PublicNode', isPublic: true },
  {
    chainId: 56n,
    url: 'https://bsc-dataseed.bnbchain.org',
    operator: 'BNB Chain',
    isPublic: true,
  },

  {
    chainId: 137n,
    url: 'https://polygon-bor-rpc.publicnode.com',
    operator: 'PublicNode',
    isPublic: true,
  },
  { chainId: 137n, url: 'https://polygon-rpc.com', operator: 'Polygon Labs', isPublic: true },

  {
    chainId: 42161n,
    url: 'https://arbitrum-one-rpc.publicnode.com',
    operator: 'PublicNode',
    isPublic: true,
  },
  {
    chainId: 42161n,
    url: 'https://arb1.arbitrum.io/rpc',
    operator: 'Offchain Labs',
    isPublic: true,
  },

  {
    chainId: 10n,
    url: 'https://optimism-rpc.publicnode.com',
    operator: 'PublicNode',
    isPublic: true,
  },
  { chainId: 10n, url: 'https://mainnet.optimism.io', operator: 'OP Labs', isPublic: true },

  {
    chainId: 8453n,
    url: 'https://base-rpc.publicnode.com',
    operator: 'PublicNode',
    isPublic: true,
  },
  { chainId: 8453n, url: 'https://mainnet.base.org', operator: 'Base', isPublic: true },

  {
    chainId: 43114n,
    url: 'https://avalanche-c-chain-rpc.publicnode.com',
    operator: 'PublicNode',
    isPublic: true,
  },
  {
    chainId: 43114n,
    url: 'https://api.avax.network/ext/bc/C/rpc',
    operator: 'Ava Labs',
    isPublic: true,
  },
]
