/**
 * Interface dictionary.
 *
 * WHY NO LIBRARY. `i18next` with its React wrapper adds tens of
 * kilobytes for features this app does not use: loading dictionaries
 * over the network (forbidden by the security policy), plural forms,
 * and ICU parsing. A dictionary plus substitution is thirty lines.
 *
 * ONE LANGUAGE. The wallet speaks English: that is the language of
 * the standards, network names, and node messages, and mixing in a
 * translation produced phrases like "Insufficient funds for gas" mixed with another language.
 * Substitution is kept — it will be needed when there are more
 * languages — but there is no language picker in the UI.
 */

export const LANGUAGE = {
  English: 'en',
} as const

export type Language = (typeof LANGUAGE)[keyof typeof LANGUAGE]

/** Default and only language. */
export const DEFAULT_LANGUAGE: Language = LANGUAGE.English

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
  'create.description': 'The email identifies the account, the password encrypts it',
  'create.phraseTitle': 'Save your seed phrase',
  'create.phraseDescription': 'Twelve words that restore access',
  'create.confirmTitle': 'Let us check what you wrote down',
  'create.confirmDescription': 'Pick the words that belong in the listed positions',
  'create.username': 'Email',
  'create.usernamePlaceholder': 'name@example.com',
  'create.usernameNotice': 'You will sign in with this email and the password you choose here.',
  'create.passwordNotice':
    'The password protects the wallet on this device only. It does not restore access and does not replace the seed phrase.',
  'create.acknowledge':
    'I have written down the phrase and understand that without it access to funds cannot be restored',
  'create.showPhrase': 'Show the phrase',
  'create.submit': 'Create wallet',
  'create.encrypting': 'Encrypting…',
  'create.failed': 'Could not create the wallet',

  'unlock.title': 'Welcome back',
  'unlock.description': 'Enter your email and password',
  'unlock.username': 'Email',
  'unlock.password': 'Password',
  'unlock.emailInvalid': 'Enter a valid email',
  'unlock.submit': 'Unlock',
  'unlock.decrypting': 'Unlock',
  'unlock.blocked': 'Too many attempts. Input reopens in',
  'unlock.blockedNote':
    'The delay grows with each failure and survives a page reload. It protects against password guessing by whoever got hold of the device.',
  'unlock.attemptsLeft': 'Attempts left before a delay:',
  'unlock.forgot': 'Forgot your password?',
  'unlock.createAccount': 'Create account',
  'unlock.otherWallet': 'Create another wallet or restore from a seed phrase',
  'unlock.failed': 'Could not unlock the wallet',

  'nav.wallet': 'Wallet',
  'nav.assets': 'Assets',
  'nav.nft': 'NFT',
  'nav.activity': 'Activity',
  'nav.settings': 'Settings',

  'info.section': 'Legal & information',
  'info.trust': 'Security & trust',
  'info.privacy': 'Privacy policy',
  'info.terms': 'Terms of service',

  'dashboard.balance': 'Balance',
  'dashboard.displayCurrency': 'Display currency',
  /* Two former caveats merged into one. The home screen used to show
     “Showing the native currency balance…” and “The native currency
     of the network is sent here…” in a row — two paragraphs about the
     same thing in the middle of the screen. Nothing was lost in the
     merge: that the shown amount excludes tokens, that send from here
     is native currency only, and the recipient-field warning remain. */
  'dashboard.nativeOnly':
    'The native currency of the network is sent here, and the balance above shows only it. Token balances live in the portfolio; token transfers have their own screen, where the recipient is written into the call data, not into the recipient field.',
  /* DOLLAR ESTIMATE DIRECTLY UNDER THE AMOUNT. The ether figure
     answers “how many coins do I have”, not “how much money do I
     have”, and the second question is why the screen is opened.

     “approximately” is in every state on purpose, not for softness:
     the estimate is balance times a third-party rate, it changes
     every minute, and nobody has promised to pay that amount. */
  'dashboard.approxValue': 'approximately {value}',
  'dashboard.valueLoading': 'Estimating the value…',
  'dashboard.valueUnknown': 'The value could not be estimated',
  'dashboard.valueOff': 'Show the value in dollars',
  /* Quote time, not “updated just now”. The wallet asks for a rate
     once a minute while the screen is open, but a source failure
     leaves the previous one — and the only way to tell them apart
     is the timestamp. */
  'dashboard.rateAsOf': 'Rate as of {time}',
  'dashboard.portfolio': 'Portfolio',
  'dashboard.send': 'Send',
  'dashboard.receive': 'Receive',
  'dashboard.refresh': 'Refresh',
  'dashboard.lock': 'Lock',
  'dashboard.smartContract': 'Smart contract',

  /* PLACEHOLDER DIALOG TO CHECK THE LOOK. The wallet cannot call
     contracts yet; the dialog shows how the enabled mode will look.
     See A-172 in TECH_DEBT. */
  'contract.activatedTitle': 'Smart contract mode activated',
  'contract.activatedDescription': 'The wallet is ready to prepare contract calls.',
  'contract.activatedStatus': 'Contract module is active',
  'contract.activatedConfirm': 'Got it',
  'dashboard.recent': 'Recent activity',
  /* ONE NAME FOR THE SCREEN. The nav called it “Activity”, the
     heading “History”, the home link “Full history”, the nearby
     copy “History section”: one place under two names, and the
     user had to join them.

     “Activity” won because the screen is not only completed
     transfers: pending sends with speed-up and cancel are not
     history. The name follows the content. */
  'dashboard.allActivity': 'All activity',

  /* Asset showcase on home: the same strings as the Assets screen. */
  'dashboard.assets': 'Assets',
  'dashboard.allAssets': 'All assets',
  'dashboard.assetsEmptyTitle': 'No assets yet',
  'dashboard.assetsEmpty': 'Tracked tokens of this account will appear here.',

  /* Public market, not the portfolio: the request never names the owner. */
  'dashboard.prices': 'Cryptocurrency Prices',
  'dashboard.pricesCaption': 'Cryptocurrency market prices in US dollars',
  'dashboard.pricesRank': '#',
  'dashboard.pricesCoin': 'Coin',
  'dashboard.pricesPrice': 'Price',
  'dashboard.prices1h': '1h',
  'dashboard.prices24h': '24h',
  'dashboard.prices7d': '7d',
  'dashboard.pricesVolume': '24h Volume',
  'dashboard.pricesMarketCap': 'Market Cap',
  'dashboard.pricesShowMore': 'Show more',
  'dashboard.pricesRetry': 'Try again',
  'dashboard.pricesFailedTitle': 'Prices are unavailable',
  'dashboard.pricesFailed':
    'The public market list could not be loaded. This is not your balance — your funds are not affected.',
  'dashboard.pricesEmptyTitle': 'No coins in the list',
  'dashboard.pricesEmpty': 'The source returned no coins.',
} as const

export type TranslationKey = keyof typeof ENGLISH

export const DICTIONARIES: Readonly<Record<Language, Readonly<Record<TranslationKey, string>>>> = {
  [LANGUAGE.English]: ENGLISH,
}
