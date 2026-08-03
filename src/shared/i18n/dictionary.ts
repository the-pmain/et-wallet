/**
 * Словарь интерфейса.
 *
 * ПОЧЕМУ БЕЗ БИБЛИОТЕКИ. `i18next` с реактовской обвязкой добавляет
 * к бандлу десятки килобайт ради возможностей, которых здесь нет:
 * загрузки словарей по сети (запрещена политикой безопасности),
 * подстановки по числам во многих формах и разбора ICU. Нужен словарь
 * и функция подстановки — это тридцать строк.
 *
 * ЯЗЫК ОДИН. Кошелёк говорит по-английски: это язык, на котором
 * написаны стандарты, названия сетей и сообщения узлов, и смешение
 * с переводом порождало бы фразы вроде «Недостаточно средств для gas».
 * Механизм подстановки сохранён — он понадобится, когда языков станет
 * больше, — но выбора языка в интерфейсе нет.
 */

/** Поддерживаемые языки. */
export const LANGUAGE = {
  English: 'en',
} as const

export type Language = (typeof LANGUAGE)[keyof typeof LANGUAGE]

/** Язык по умолчанию и единственный. */
export const DEFAULT_LANGUAGE: Language = LANGUAGE.English

/** Словарь интерфейса. */
const ENGLISH = {
  'common.back': 'Back',
  'common.next': 'Next',
  'common.cancel': 'Cancel',
  'common.language': 'Language',

  'welcome.tagline': 'Your keys. Your crypto.',
  'welcome.headline': 'Your keys stay yours',
  'welcome.subtitle': '{app} keeps private keys encrypted on your device.',
  'welcome.create': 'Create a new wallet',
  'welcome.import': 'Import with a seed phrase',
  'welcome.trust': 'What you are trusting when you use a wallet in a browser',
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
  'unlock.otherWallet': 'Create another wallet or restore from a seed phrase',
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
} as const

/** Ключ перевода. */
export type TranslationKey = keyof typeof ENGLISH

/** Словари по языкам. */
export const DICTIONARIES: Readonly<Record<Language, Readonly<Record<TranslationKey, string>>>> = {
  [LANGUAGE.English]: ENGLISH,
}
