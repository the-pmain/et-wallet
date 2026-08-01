import type { ChainId } from '@/core/types'

/** Нативная валюта сети. */
export interface INativeCurrency {
  readonly name: string
  readonly symbol: string

  /**
   * Число десятичных знаков. Для Ethereum — 18.
   *
   * Хранится в конфигурации, а не берётся константой: сети с иным числом
   * знаков существуют, и жёсткая цифра 18 в коде приведёт к отображению
   * суммы, отличающейся от реальной на порядки.
   */
  readonly decimals: number
}

/**
 * Конфигурация блокчейн-сети.
 *
 * Это ДАННЫЕ: сериализуемые, хранимые, редактируемые пользователем.
 * Живое соединение с узлом описывает `IProvider` — см. пояснение
 * о разделении понятий в его файле.
 */
export interface INetworkConfig {
  readonly chainId: ChainId

  /** Отображаемое имя сети. */
  readonly name: string

  readonly nativeCurrency: INativeCurrency

  /**
   * Адреса RPC-узлов в порядке приоритета.
   *
   * Список, а не одно значение: узел может быть недоступен, и переключение
   * на резервный не должно требовать вмешательства пользователя.
   *
   * ТРЕБОВАНИЕ БЕЗОПАСНОСТИ: допустимы только схемы `https:` и `wss:`.
   * Открытый HTTP позволяет посреднику подменить баланс, nonce, цену газа
   * и результат вызова контракта — пользователь подпишет транзакцию,
   * отличную от показанной. Проверка выполняется при добавлении сети
   * и приводит к `InsecureRpcUrlError`.
   */
  readonly rpcUrls: readonly string[]

  /** Адреса обозревателей блоков для построения ссылок на транзакции. */
  readonly blockExplorerUrls: readonly string[]

  /**
   * Тестовая сеть.
   *
   * Влияет не только на оформление: операции в тестовой сети не должны
   * учитываться в сводной стоимости портфеля, иначе пользователь увидит
   * несуществующие средства.
   */
  readonly isTestnet: boolean

  /**
   * Встроенная сеть.
   *
   * Встроенные сети нельзя удалить, а их chainId и RPC не редактируются
   * пользователем. Это защита от подмены параметров основной сети
   * через интерфейс добавления сети — приём, применяемый в фишинге.
   */
  readonly isBuiltIn: boolean

  /** Поддерживает ли сеть транзакции EIP-1559. */
  readonly supportsEip1559: boolean
}

/** Параметры добавления пользовательской сети. */
export interface IAddNetworkParams {
  readonly chainId: ChainId
  readonly name: string
  readonly nativeCurrency: INativeCurrency
  readonly rpcUrls: readonly string[]
  readonly blockExplorerUrls?: readonly string[]
  readonly isTestnet?: boolean

  /**
   * Согласие добавить сеть, чьё имя совпадает с именем встроенной.
   *
   * Отдельный флаг, а не молчаливое разрешение: совпадение имени —
   * основной приём подмены сети, и добавление должно требовать
   * осознанного подтверждения. Значение по умолчанию `false` означает
   * отказ с ошибкой `NetworkImpersonationError`, которую интерфейс
   * обязан показать пользователю до повторной попытки.
   */
  readonly allowImpersonation?: boolean
}

/** События сетевого слоя. */
export interface NetworkEventMap {
  /** Активная сеть изменена. */
  'network:changed': { readonly chainId: ChainId }
  /** Список доступных сетей изменён. */
  'network:listChanged': { readonly chainIds: readonly ChainId[] }
}
