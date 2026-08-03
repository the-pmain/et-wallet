import { ShieldCheck } from 'lucide-react'

import type { IToken } from '@/core'
import { Badge } from '@/shared/ui'

/**
 * Пометка доверия к контракту токена.
 *
 * ЗАЧЕМ ОНА. Символ токена задаёт автор контракта: выпустить `USDC`
 * может кто угодно, и в списке активов подделка выглядит как оригинал.
 * Отличает их только адрес, а сверять сорок два символа глазами человек
 * не станет.
 *
 * ТРИ СОСТОЯНИЯ, И КАЖДОЕ ЗНАЧИТ СВОЁ:
 *
 * - `verified` — адрес совпал со встроенным списком. Это утверждение
 *   об АДРЕСЕ, а не о надёжности проекта: обещать второе кошелёк
 *   не может;
 * - `unverified` — адрес добавлен вручную и в списке его нет. Это НЕ
 *   обвинение в подделке: список заведомо неполон, и подавляющее
 *   большинство законных токенов в него не входит;
 * - пусто — нативная валюта сети, она часть конфигурации.
 *
 * ПРОВЕРЕННОЕ ВЫДЕЛЕНО ЗНАЧКОМ, А НЕ ЦВЕТОМ. Зелёная метка на каждой
 * второй строке перестаёт читаться, а цвет как единственный признак
 * недоступен людям с нарушением цветовосприятия.
 */
export function TokenTrustBadge({ token }: { readonly token: IToken }) {
  if (token.address === null) {
    return null
  }

  if (token.isVerified) {
    return (
      <Badge variant="outline" title="The contract address matches the built-in list">
        <ShieldCheck className="size-3" aria-hidden />
        verified
      </Badge>
    )
  }

  return token.isCustom ? (
    <Badge variant="outline" title="The contract is not in the built-in list — check its address">
      unverified
    </Badge>
  ) : null
}
