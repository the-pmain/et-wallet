/**
 * Словари интерфейса.
 *
 * ПОЧЕМУ БЕЗ БИБЛИОТЕКИ. `i18next` с реактовской обвязкой добавляет
 * к бандлу десятки килобайт ради возможностей, которых здесь нет:
 * загрузки словарей по сети (запрещена политикой безопасности),
 * подстановки по числам во многих формах и разбора ICU. Нужен словарь
 * и функция подстановки — это тридцать строк.
 *
 * КЛЮЧИ ТИПИЗИРОВАНЫ. Русский словарь объявлен первым и служит
 * образцом: английский обязан содержать ровно те же ключи, иначе
 * сборка не пройдёт. Пропущенный перевод в кошельке — это пустая
 * строка на месте предупреждения о риске.
 *
 * ОБЪЁМ ЭТОГО ЭТАПА. Переведены экраны входа, панель и навигация.
 * Остальные экраны остаются на русском и переводятся следующими
 * этапами; отсутствие ключа для них — не ошибка, они просто пока
 * не обращаются к словарю.
 */

/** Поддерживаемые языки. */
export const LANGUAGE = {
  Russian: 'ru',
  English: 'en',
} as const

export type Language = (typeof LANGUAGE)[keyof typeof LANGUAGE]

/** Язык по умолчанию. Используется, когда выбор не сделан и не угадан. */
export const DEFAULT_LANGUAGE: Language = LANGUAGE.Russian

const RUSSIAN = {
  /* Общее */
  'common.back': 'Назад',
  'common.next': 'Далее',
  'common.cancel': 'Отмена',
  'common.language': 'Язык',

  /* Приветствие */
  'welcome.tagline': 'Ваши ключи. Ваша криптовалюта.',
  'welcome.headline': 'Ваши ключи остаются у вас',
  'welcome.subtitle': '{app} хранит приватные ключи зашифрованными на вашем устройстве.',
  'welcome.create': 'Создать новый кошелёк',
  'welcome.import': 'Импортировать по seed-фразе',
  'welcome.notice':
    'Доступ восстанавливается только seed-фразой: мы не храним ключи и не сможем помочь при её утрате. Никакая поддержка никогда не попросит эту фразу — такая просьба означает попытку кражи.',
  'welcome.noticeTestMode':
    'Вход по seed-фразе временно отключён для тестирования. Восстановить кошелёк при забытом пароле сейчас нечем: сохраните фразу, показанную при создании.',

  /* Создание кошелька */
  'create.title': 'Создайте кошелёк',
  'create.description': 'Имя подписывает кошелёк, пароль его шифрует',
  'create.phraseTitle': 'Сохраните seed-фразу',
  'create.phraseDescription': 'Двенадцать слов, восстанавливающих доступ',
  'create.confirmTitle': 'Проверим, что вы записали',
  'create.confirmDescription': 'Выберите слова, которые стоят на указанных местах',
  'create.username': 'Имя пользователя',
  'create.usernamePlaceholder': 'Например, Дмитрий',
  'create.usernameNotice':
    'Имя хранится только на этом устройстве и подписывает кошелёк в интерфейсе. Это не учётная запись: восстановить доступ по имени невозможно, и обращаться за этим некуда.',
  'create.passwordNotice':
    'Пароль защищает кошелёк только на этом устройстве. Он не восстанавливает доступ и не заменяет seed-фразу.',
  'create.acknowledge':
    'Я записал фразу и понимаю, что без неё доступ к средствам восстановить невозможно',
  'create.skipConfirmationNotice':
    'Проверка записанной фразы временно отключена для ускоренного тестирования. Кошелёк будет создан сразу. Если фраза нигде не записана, потеря устройства означает потерю средств безвозвратно.',
  'create.showPhrase': 'Показать фразу',
  'create.submit': 'Создать кошелёк',
  'create.encrypting': 'Шифрование…',
  'create.failed': 'Не удалось создать кошелёк',

  /* Разблокировка */
  'unlock.title': 'С возвращением',
  'unlock.description': 'Введите пароль, чтобы разблокировать кошелёк',
  'unlock.password': 'Пароль',
  'unlock.submit': 'Разблокировать',
  'unlock.decrypting': 'Расшифровка…',
  'unlock.blocked': 'Слишком много попыток. Ввод откроется через',
  'unlock.blockedNote':
    'Задержка растёт с каждой неудачей и переживает перезагрузку страницы. Она защищает от подбора пароля тем, кто получил доступ к устройству.',
  'unlock.attemptsLeft': 'Осталось попыток до задержки:',
  'unlock.forgot': 'Забыли пароль?',
  'unlock.failed': 'Не удалось разблокировать кошелёк',

  /* Навигация */
  'nav.wallet': 'Кошелёк',
  'nav.assets': 'Активы',
  'nav.nft': 'NFT',
  'nav.activity': 'История',
  'nav.settings': 'Настройки',

  /* Панель */
  'dashboard.balance': 'Баланс',
  'dashboard.nativeOnly': 'Показан баланс нативной валюты. Токены и оценка стоимости — в портфеле.',
  'dashboard.portfolio': 'Портфель',
  'dashboard.send': 'Отправить',
  'dashboard.receive': 'Получить',
  'dashboard.refresh': 'Обновить',
  'dashboard.lock': 'Заблокировать',
  'dashboard.smartContract': 'Смарт контракт',
  'dashboard.recent': 'Последние операции',
  'dashboard.allHistory': 'Вся история',
} as const

/** Ключ перевода. Выводится из русского словаря: он полон по построению. */
export type TranslationKey = keyof typeof RUSSIAN

/**
 * Английский словарь.
 *
 * Тип требует ровно тех же ключей: пропущенный перевод останавливает
 * сборку, а не превращается в пустое место на экране.
 */
const ENGLISH: Readonly<Record<TranslationKey, string>> = {
  'common.back': 'Back',
  'common.next': 'Next',
  'common.cancel': 'Cancel',
  'common.language': 'Language',

  'welcome.tagline': 'Your keys. Your crypto.',
  'welcome.headline': 'Your keys stay yours',
  'welcome.subtitle': '{app} keeps private keys encrypted on your device.',
  'welcome.create': 'Create a new wallet',
  'welcome.import': 'Import with a seed phrase',
  'welcome.notice':
    'Your seed phrase is the only way to restore access: we do not store keys and cannot help if it is lost. No support team will ever ask for it — such a request is an attempt to steal your funds.',
  'welcome.noticeTestMode':
    'Seed phrase sign-in is temporarily disabled for testing. There is currently no way to restore the wallet if you forget the password: save the phrase shown during creation.',

  'create.title': 'Create a wallet',
  'create.description': 'The name labels the wallet, the password encrypts it',
  'create.phraseTitle': 'Save your seed phrase',
  'create.phraseDescription': 'Twelve words that restore access',
  'create.confirmTitle': 'Let us check what you wrote down',
  'create.confirmDescription': 'Pick the words that belong in the listed positions',
  'create.username': 'Your name',
  'create.usernamePlaceholder': 'For example, Alex',
  'create.usernameNotice':
    'The name is stored on this device only and labels the wallet in the interface. This is not an account: access cannot be restored by name, and there is nobody to ask.',
  'create.passwordNotice':
    'The password protects the wallet on this device only. It does not restore access and does not replace the seed phrase.',
  'create.acknowledge':
    'I have written down the phrase and understand that without it access to funds cannot be restored',
  'create.skipConfirmationNotice':
    'Seed phrase verification is temporarily disabled for faster testing. The wallet will be created immediately. If the phrase is not written down anywhere, losing this device means losing the funds for good.',
  'create.showPhrase': 'Show the phrase',
  'create.submit': 'Create wallet',
  'create.encrypting': 'Encrypting…',
  'create.failed': 'Could not create the wallet',

  'unlock.title': 'Welcome back',
  'unlock.description': 'Enter your password to unlock the wallet',
  'unlock.password': 'Password',
  'unlock.submit': 'Unlock',
  'unlock.decrypting': 'Decrypting…',
  'unlock.blocked': 'Too many attempts. Input reopens in',
  'unlock.blockedNote':
    'The delay grows with each failure and survives a page reload. It protects against password guessing by whoever got hold of the device.',
  'unlock.attemptsLeft': 'Attempts left before a delay:',
  'unlock.forgot': 'Forgot your password?',
  'unlock.failed': 'Could not unlock the wallet',

  'nav.wallet': 'Wallet',
  'nav.assets': 'Assets',
  'nav.nft': 'NFT',
  'nav.activity': 'Activity',
  'nav.settings': 'Settings',

  'dashboard.balance': 'Balance',
  'dashboard.nativeOnly':
    'Showing the native currency balance. Tokens and value estimates live in the portfolio.',
  'dashboard.portfolio': 'Portfolio',
  'dashboard.send': 'Send',
  'dashboard.receive': 'Receive',
  'dashboard.refresh': 'Refresh',
  'dashboard.lock': 'Lock',
  'dashboard.smartContract': 'Smart contract',
  'dashboard.recent': 'Recent activity',
  'dashboard.allHistory': 'Full history',
}

/** Словари по языкам. */
export const DICTIONARIES: Readonly<Record<Language, Readonly<Record<TranslationKey, string>>>> = {
  [LANGUAGE.Russian]: RUSSIAN,
  [LANGUAGE.English]: ENGLISH,
}

/** Названия языков на них самих: так их узнают, не зная текущего. */
export const LANGUAGE_NAME: Readonly<Record<Language, string>> = {
  [LANGUAGE.Russian]: 'Русский',
  [LANGUAGE.English]: 'English',
}

/** Является ли строка поддерживаемым языком. */
export function isLanguage(value: string): value is Language {
  return value === LANGUAGE.Russian || value === LANGUAGE.English
}
