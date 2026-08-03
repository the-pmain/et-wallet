import { findForeignCharacters, toNameSkeleton } from '@/core/security'
import type { Address, ChainId } from '@/core/types'

import { listVerifiedTokens, type IVerifiedToken } from './verified'

/** Обнаруженная попытка выдать чужой контракт за проверенный токен. */
export interface ITokenImpersonation {
  /** Проверенный токен, за который выдаёт себя контракт. */
  readonly verified: IVerifiedToken

  /** Что именно совпало: символ либо имя. */
  readonly field: 'symbol' | 'name'

  /** Символы вне латиницы и цифр. Пусто при совпадении по буквам. */
  readonly foreignCharacters: readonly string[]
}

/**
 * Ищет контракт, выдающий себя за проверенный токен.
 *
 * ЗАЧЕМ. Символ и имя токена задаёт автор контракта — это не свойство
 * сети и не факт, а строка, которую контракт возвращает по запросу.
 * Назваться `USDC` может любой. Дальше владелец видит в списке
 * привычный символ, отправляет на этот «USDC» средства и обнаруживает,
 * что перевёл ничего не стоящий токен, либо выдаёт разрешение
 * контракту, которого не проверял никто.
 *
 * ЭТО ТА ЖЕ АТАКА, ЧТО И С ИМЕНЕМ СЕТИ, и ловится тем же приёмом:
 * `USDС` с кириллической `С` не совпадает с настоящим ни в одном
 * байте, а на экране это то же слово. Сравнение идёт по «скелету».
 *
 * ЭТАЛОН ЕСТЬ ТОЛЬКО ДЛЯ ПРОВЕРЕННЫХ ТОКЕНОВ, и в этом ограничение
 * проверки: подделку под токен, которого нет в списке, сравнивать
 * не с чем. Список покрывает то, ради чего подделки и делают, —
 * стейблкоины и обёрнутые активы.
 *
 * СОВПАДЕНИЕ С САМИМ СОБОЙ ПОДДЕЛКОЙ НЕ СЧИТАЕТСЯ: проверенный
 * контракт вправе называться своим именем.
 */
export function findTokenImpersonation(
  candidate: {
    readonly chainId: ChainId
    readonly address: Address
    readonly symbol: string
    readonly name: string
  },
  verifiedTokens: readonly IVerifiedToken[] = listVerifiedTokens(candidate.chainId),
): ITokenImpersonation | null {
  const symbolSkeleton = toNameSkeleton(candidate.symbol)
  const nameSkeleton = toNameSkeleton(candidate.name)

  for (const verified of verifiedTokens) {
    if (verified.address.toLowerCase() === candidate.address.toLowerCase()) {
      continue
    }

    /* Символ сравнивается первым: именно он показан в списке активов
       и в подтверждении отправки, тогда как полное имя видно не везде. */
    if (symbolSkeleton !== '' && toNameSkeleton(verified.symbol) === symbolSkeleton) {
      return {
        verified,
        field: 'symbol',
        foreignCharacters: findForeignCharacters(candidate.symbol),
      }
    }

    if (nameSkeleton !== '' && toNameSkeleton(verified.name) === nameSkeleton) {
      return {
        verified,
        field: 'name',
        foreignCharacters: findForeignCharacters(candidate.name),
      }
    }
  }

  return null
}
