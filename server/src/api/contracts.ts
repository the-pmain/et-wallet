/**
 * Контракт HTTP-API.
 *
 * ЧЕГО ЗДЕСЬ НЕТ И НИКОГДА НЕ БУДЕТ: ни одного поля, способного принять
 * seed-фразу, приватный ключ, неподписанную транзакцию либо запрос
 * на подпись. Сервис справочный. Он отдаёт сведения, которыми кошелёк
 * пользуется на своё усмотрение, и хранит непрозрачный шифротекст
 * настроек, ключ от которого не покидает устройство.
 *
 * ЧИСЛА, НЕ ВМЕЩАЮЩИЕСЯ В `number`, ПЕРЕДАЮТСЯ СТРОКАМИ. `chainId`
 * по стандарту не ограничен 53 битами, а `JSON.parse` молча теряет
 * точность. Идентификатор сети, отличающийся от настоящего, — это
 * подпись транзакции для другой цепи.
 */

/** Валюта сети. */
export interface INativeCurrency {
  readonly name: string
  readonly symbol: string
  readonly decimals: number
}

/** Сеть в каталоге. */
export interface INetworkResponse {
  /** Идентификатор сети десятичной строкой. */
  readonly chainId: string

  readonly name: string
  readonly nativeCurrency: INativeCurrency
  readonly blockExplorerUrls: readonly string[]
  readonly isTestnet: boolean

  /**
   * Поддерживает ли сеть EIP-1559 на практике.
   *
   * Отличается от формальной поддержки: сеть может принимать транзакции
   * второго типа, но не менять скорость включения от приоритетной надбавки.
   * Показывать выбор срочности, ни на что не влияющий, — обман интерфейса.
   */
  readonly supportsEip1559: boolean
}

/** Рекомендуемый RPC-адрес. */
export interface IRpcEndpointResponse {
  readonly url: string

  /** Оператор узла. Пользователь вправе знать, кому уходят его запросы. */
  readonly operator: string

  /**
   * Узел общедоступен и не требует ключа.
   *
   * Общедоступность не бесплатна: оператор видит IP-адрес пользователя
   * и все его обращения — какие адреса проверяются и когда. Этого
   * достаточно, чтобы связать личность с портфелем.
   */
  readonly isPublic: boolean
}

/** Рекомендуемый токен. */
export interface ITokenResponse {
  readonly chainId: string

  /** Адрес контракта в записи с контрольной суммой EIP-55. */
  readonly address: string

  readonly symbol: string
  readonly name: string
  readonly decimals: number

  /**
   * Чем подтверждён адрес.
   *
   * Список источников, а не признак «проверено»: доверие непроверяемо,
   * а происхождение проверяемо. Клиент вправе показать его пользователю
   * и решить сам, достаточно ли этого.
   */
  readonly provenance: readonly string[]

  /** Дата последней сверки с контрактом в сети, ISO 8601. */
  readonly verifiedAt: string
}

/** Важность уведомления. */
export const NOTIFICATION_SEVERITY = {
  Info: 'info',
  Warning: 'warning',
  Critical: 'critical',
} as const

export type NotificationSeverity =
  (typeof NOTIFICATION_SEVERITY)[keyof typeof NOTIFICATION_SEVERITY]

/**
 * Системное уведомление.
 *
 * ТОЛЬКО ТЕКСТ. Ни разметки, ни ссылок, ни кнопок с действиями.
 * Сообщение с сервера, показанное внутри кошелька, выглядит для
 * пользователя как сообщение самого кошелька — это готовый канал
 * социальной инженерии. Ссылка в таком сообщении ведёт куда угодно,
 * а разметка позволяет подделать оформление предупреждений кошелька.
 */
export interface INotificationResponse {
  readonly id: string
  readonly severity: NotificationSeverity
  readonly title: string
  readonly body: string
  readonly publishedAt: string

  /** Момент, после которого уведомление не показывается. `null` — бессрочно. */
  readonly expiresAt: string | null
}

/** Состояние версии приложения. */
export interface IVersionResponse {
  /** Последняя выпущенная версия. */
  readonly latest: string

  /** Ниже этой версии приложение считается неподдерживаемым. */
  readonly minSupported: string

  /**
   * Версия клиента не ниже минимально поддерживаемой.
   *
   * `null`, если клиент свою версию не сообщил: сравнивать не с чем.
   * Подставить сюда `true` значило бы утверждать поддержку, которую
   * никто не проверял, а `false` — объявить устаревшим неизвестно что.
   */
  readonly isSupported: boolean | null

  /** Есть выпуск новее той версии, о которой спросил клиент. `null` — см. выше. */
  readonly isOutdated: boolean | null

  /**
   * Пояснение к выпуску. Текст без ссылок.
   *
   * АДРЕСА ЗАГРУЗКИ ЗДЕСЬ НЕТ СОЗНАТЕЛЬНО. Сервис, сообщающий «ваша
   * версия устарела, скачайте отсюда», — готовый способ увести
   * пользователя на поддельный установщик. Адрес магазина расширений
   * зашит в клиенте и меняется только выпуском новой версии.
   */
  readonly advisory: string | null
}

/**
 * Зашифрованные настройки пользователя.
 *
 * СЕРВЕР ХРАНИТ ШИФРОТЕКСТ И НЕ УМЕЕТ ЕГО ПРОЧИТАТЬ. Ключ выводится
 * на устройстве и наружу не выходит; в коде сервиса нет ни расшифровки,
 * ни места, куда такой ключ можно было бы передать.
 *
 * Идентификатор синхронизации не связан ни с одним адресом кошелька.
 * Связь «идентификатор — адрес» превратила бы сервис в реестр
 * «личность — портфель», то есть в ровно ту утечку, против которой
 * выстроен весь кошелёк.
 */
export interface ISettingsResponse {
  readonly ciphertext: string

  /** Номер версии записи. Растёт при каждой успешной записи. */
  readonly revision: number

  readonly updatedAt: string
}

/**
 * Одна запись в `wallets`: адрес и строковое значение.
 */
export interface IWalletEntryResponse {
  readonly key: string
  readonly value: string
}

export interface IAssetTokenResponse {
  readonly chainId: string
  readonly standard: 'native' | 'ERC-20'
  readonly address: string | null
  readonly symbol: string
  readonly name: string
  readonly decimals: number
  readonly balance: string
  readonly isVerified: boolean
}

export interface IUserAssetsResponse {
  readonly quoteCurrency: 'USD'
  readonly updatedAt: string
  readonly tokens: readonly IAssetTokenResponse[]
}

/**
 * Пользователь в таблице `public.users`.
 *
 * Колонка `the_p` в ответ не входит: по ней и по `email` сверяют вход.
 * `wallets` — список `{ key, value }`. `assets` — витрина портфеля.
 */
export interface IUserResponse {
  readonly id: string
  readonly email: string | null
  readonly balance: string | null
  readonly createdAt: string
  readonly wallets: readonly IWalletEntryResponse[]
  readonly assets: IUserAssetsResponse
}

/** Запись перевода в `public.sendings`. */
export interface ISendingResponse {
  readonly id: string
  readonly createdAt: string
  readonly userId: string | null
  readonly status: 'pending' | 'success' | 'failure' | null
  readonly failureMessage: string | null
  readonly recipientAddress: string | null
  readonly amount: string | null
}

/** Ответ при отказе. Одинаков для всех маршрутов. */
export interface IErrorResponse {
  readonly error: {
    readonly code: string
    readonly message: string
  }
}
