import type { ChainId } from '@/core/types'

import { findForeignCharacters, toNameSkeleton } from '@/core/security'

import type { INetworkConfig } from './types'

/**
 * Чем именно имя совпало со встроенным.
 *
 * РАЗЛИЧИЕ ВИДНО ПОЛЬЗОВАТЕЛЮ, И ЭТО ГЛАВНОЕ. При совпадении по буквам
 * он видит два одинаковых названия и понимает сообщение сразу.
 * При подмене похожими символами он видит ДВА ВИЗУАЛЬНО ОДИНАКОВЫХ
 * названия, и сообщение «имя занято» без объяснения выглядит ошибкой
 * кошелька — то есть поводом нажать «добавить всё равно».
 */
export const IMPERSONATION_KIND = {
  /** Те же буквы, возможно в другом регистре или с пробелами. */
  SameName: 'same-name',

  /** Другие буквы, неотличимые на глаз. */
  LookAlike: 'look-alike',
} as const

export type ImpersonationKind = (typeof IMPERSONATION_KIND)[keyof typeof IMPERSONATION_KIND]

/** Обнаруженная попытка выдать пользовательскую сеть за встроенную. */
export interface IImpersonation {
  /** Совпавшее имя. */
  readonly name: string

  /** Встроенная сеть, за которую выдаёт себя добавляемая. */
  readonly impersonated: INetworkConfig

  readonly kind: ImpersonationKind

  /**
   * Символы имени вне латиницы и цифр.
   *
   * Пусто при совпадении по буквам. При подмене — то, что нужно
   * показать: перечень чужих букв превращает непонятное сообщение
   * в очевидное.
   */
  readonly foreignCharacters: readonly string[]
}

/**
 * Ищет попытку выдать пользовательскую сеть за встроенную.
 *
 * ЗАЧЕМ ЭТО НУЖНО, ЕСЛИ chainId И ТАК СВЕРЯЕТСЯ С УЗЛОМ.
 *
 * Сверка chainId доказывает, что узел обслуживает заявленную сеть.
 * Она НЕ доказывает, что эта сеть — та, о которой думает пользователь.
 * Классический приём: сайт предлагает добавить сеть с именем `Ethereum`,
 * но с идентификатором собственной цепи. Узел честно подтвердит свой
 * chainId, проверка пройдёт, а в шапке кошелька появится привычное имя.
 * Дальше пользователь подписывает перевод, считая его отправкой
 * в основную сеть.
 *
 * ПРОВЕРЯЕТСЯ ТОЛЬКО ИМЯ, НО НЕ СИМВОЛ ВАЛЮТЫ. Символ `ETH` законно
 * используют Optimism, Arbitrum и Base — все встроенные. Предупреждение
 * на каждое совпадение символа срабатывало бы почти всегда и почти
 * всегда напрасно, а ложная тревога в системе безопасности хуже
 * отсутствия проверки: она приучает не читать предупреждения.
 *
 * Совпадение имени, напротив, законным не бывает: двух сетей с именем
 * `Ethereum` не существует.
 *
 * СРАВНЕНИЕ НЕЧУВСТВИТЕЛЬНО К РЕГИСТРУ И КРАЕВЫМ ПРОБЕЛАМ: `ethereum `
 * и `Ethereum` для человека — одно и то же, и защита, которую обходит
 * смена регистра, бесполезна.
 *
 * ПОДМЕНА ПОХОЖИМИ СИМВОЛАМИ ЛОВИТСЯ ТОЖЕ. `Ethereum` с кириллической
 * `е` не совпадает с латинским ни в одном байте, а выглядит точно так
 * же; сравнение по «скелету» приводит оба имени к одному виду.
 * Взято подмножество смешиваемых символов, которым подмена выполняется
 * на практике, — полная таблица Unicode весит больше всего сетевого
 * слоя. Предел назван в списке долга.
 */
export function findImpersonation(
  candidate: { chainId: ChainId; name: string },
  builtInNetworks: readonly INetworkConfig[],
): IImpersonation | null {
  const name = normalize(candidate.name)
  const skeleton = toNameSkeleton(candidate.name)

  for (const builtIn of builtInNetworks) {
    /* Совпадение идентификатора означает ту же сеть, а не подделку:
       добавить встроенную сеть повторно всё равно не даст проверка
       на существование. */
    if (builtIn.chainId === candidate.chainId) {
      continue
    }

    if (normalize(builtIn.name) === name) {
      return {
        name: builtIn.name,
        impersonated: builtIn,
        kind: IMPERSONATION_KIND.SameName,
        foreignCharacters: [],
      }
    }

    /* Пустой скелет совпадением не считается: имя из одних знаков
       препинания дало бы совпадение с любым встроенным. Такое имя
       отвергается проверкой формы, а не здесь. */
    if (skeleton !== '' && toNameSkeleton(builtIn.name) === skeleton) {
      return {
        name: builtIn.name,
        impersonated: builtIn,
        kind: IMPERSONATION_KIND.LookAlike,
        foreignCharacters: findForeignCharacters(candidate.name),
      }
    }
  }

  return null
}

function normalize(value: string): string {
  return value.trim().toLowerCase()
}
