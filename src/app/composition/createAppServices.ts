import {
  AlchemyHistoryProvider,
  AlchemyProvider,
  CoinGeckoPriceProvider,
  type ITenderlyCredentials,
  ConsoleLogger,
  LogScanHistoryProvider,
  CustomRpcProvider,
  EncryptionService,
  IndexedDbStorageService,
  LedgerDevice,
  PublicRpcProvider,
  SecureStorage,
  SystemClock,
  type IClock,
  type IHardwareDevice,
  type IStorageService,
} from '@/core'
import { DappSessionService, SecureSessionStorage, WalletConnectTransport } from '@/features/dapp'
import {
  OnboardingService,
  RemoteUserDirectory,
  WalletBroadcast,
  type IOnboardingService,
} from '@/features/onboarding'
import { SecuritySettingsRepository } from '@/features/security'
import { WalletSession, type IWalletSession } from '@/features/wallet'
import { APP_CONFIG } from '@/shared/config'

import { syncCreatedWalletsToDirectory } from './sync-wallets'

/** Сервисы, живущие всё время работы приложения. */
export interface IAppServices {
  readonly onboarding: IOnboardingService
  readonly session: IWalletSession

  /**
   * Канал оповещения между вкладками.
   *
   * Собирается здесь, а не внутри провайдера: сервис отправляет
   * сообщения, провайдер их принимает, и канал у них обязан быть один.
   */
  readonly broadcast: WalletBroadcast

  /**
   * Источник времени.
   *
   * Отдаётся наружу ради автоблокировки: она отсчитывает бездействие,
   * и тест обязан уметь подставить управляемые часы вместо системных.
   */
  readonly clock: IClock

  /** Настройки безопасности: срок автоблокировки, подтверждение подписи. */
  readonly securitySettings: SecuritySettingsRepository

  /** Подключения к приложениям. Транспорт поднимается по требованию. */
  readonly dappSessions: DappSessionService

  /**
   * Хранилище приложения.
   *
   * Отдаётся наружу ради одного вопроса: переживут ли данные закрытие
   * вкладки и не вправе ли браузер их вытеснить. Ответ определяет,
   * увидит ли владелец предупреждение о риске потерять кошелёк.
   */
  readonly storage: IStorageService
}

/**
 * Composition root приложения.
 *
 * ЗДЕСЬ И ТОЛЬКО ЗДЕСЬ выбираются конкретные реализации. Ни один сервис
 * не создаёт свои зависимости сам: подмена хранилища при переходе
 * на IndexedDB либо на `chrome.storage` в расширении затронет этот файл
 * и больше ни один.
 *
 * ОДНО ЗАЩИЩЁННОЕ ХРАНИЛИЩЕ НА ВСЁ ПРИЛОЖЕНИЕ. `SecureStorage` владеет
 * сессионным ключом шифрования, полученным из пароля. Второй экземпляр
 * поверх того же хранилища имел бы собственный ключ и не смог бы прочитать
 * записанное первым — отсюда общий экземпляр для онбординга и для сессии
 * кошелька.
 *
 * ХРАНИЛИЩЕ ПОСТОЯННОЕ. Данные лежат в IndexedDB и переживают
 * перезагрузку вкладки. Хранилище в памяти осталось в проекте
 * для тестов и для возможного режима «не оставлять следов
 * на этом устройстве».
 *
 * БРАУЗЕР ВПРАВЕ ВЫТЕСНИТЬ ДАННЫЕ САЙТА при нехватке места, а для
 * кошелька это потеря зашифрованной seed-фразы. Хранилище просит
 * постоянного хранения при открытии; получено оно или нет, видно
 * через `IndexedDbStorageService.isPersistent`.
 */
export function createAppServices(): IAppServices {
  const storage = new IndexedDbStorageService()
  const encryption = new EncryptionService()
  const secureStorage = new SecureStorage(storage, encryption)
  const clock = new SystemClock()
  const logger = new ConsoleLogger()

  const session = new WalletSession({
    secureStorage,
    storage,
    clock,
    logger,
    rpcProviders: createRpcProviders(secureStorage),
    historyProviders: createHistoryProviders(),
    priceProvider: createPriceProvider(),
    tenderlyCredentials: readTenderlyCredentials(),
    connectHardware: connectLedger,
  })

  const broadcast = new WalletBroadcast()
  const dappSessions = createDappSessions(session, secureStorage, logger)
  const userDirectory = createUserDirectory(logger)

  notifyDappsOnWalletChange(session, dappSessions)

  if (userDirectory !== undefined) {
    syncCreatedWalletsToDirectory(session, userDirectory)
  }

  return {
    onboarding: new OnboardingService({
      secureStorage,
      broadcast,
      ...(userDirectory === undefined ? {} : { userDirectory }),
    }),
    session,
    broadcast,
    clock,
    securitySettings: new SecuritySettingsRepository(storage),
    dappSessions,
    storage,
  }
}

/**
 * Уведомляет подключённые приложения при смене сети либо аккаунта.
 *
 * ПОДПИСКА НА СНИМОК, А НЕ ОТДЕЛЬНОЕ СОБЫТИЕ. Сессия кошелька публикует
 * снимок целиком; здесь запоминается прежняя пара «сеть — адрес»
 * и уведомление шлётся, лишь когда она изменилась. Без сравнения
 * приложения получали бы событие на каждое обновление баланса.
 *
 * СВЯЗЬ ЖИВЁТ, ПОКА ЖИВУТ СЕРВИСЫ. Оба создаются на весь срок работы
 * приложения и вместе с ним исчезают, поэтому отписка не нужна:
 * отписываться было бы не в какой момент.
 */
export function notifyDappsOnWalletChange(
  session: Pick<IWalletSession, 'subscribe' | 'getSnapshot'>,
  dappSessions: Pick<DappSessionService, 'notifyWalletState'>,
): void {
  let previous = ''

  session.subscribe(() => {
    const snapshot = session.getSnapshot()
    const current = `${snapshot.activeNetwork?.chainId ?? ''}:${snapshot.activeAccount?.address ?? ''}`

    if (current === previous) {
      return
    }

    previous = current
    void dappSessions.notifyWalletState()
  })
}

/**
 * Подключения к приложениям.
 *
 * СЕРВИС СОБИРАЕТСЯ ВСЕГДА, ТРАНСПОРТ ПОДНИМАЕТСЯ ПО ТРЕБОВАНИЮ.
 * Библиотека WalletConnect весит около трёх мегабайт и загружается
 * динамически при заходе на экран подключений; без ключа проекта
 * раздел откроется и честно скажет, что не настроен.
 *
 * АДРЕСА И СЕТИ ЧИТАЮТСЯ ИЗ СЕССИИ ФУНКЦИЯМИ, А НЕ КОПИРУЮТСЯ.
 * Пользователь меняет аккаунт и сеть на ходу; снимок, взятый при
 * сборке, выдал бы приложению устаревшие значения.
 */
function createDappSessions(
  session: IWalletSession,
  secureStorage: SecureStorage,
  logger: ConsoleLogger,
): DappSessionService {
  const projectId = import.meta.env.VITE_WALLETCONNECT_PROJECT_ID ?? ''

  return new DappSessionService({
    transport: new WalletConnectTransport({
      projectId,
      metadata: {
        name: APP_CONFIG.name,
        description: 'Non-custodial crypto wallet',
        url: globalThis.location.origin,
        icons: [`${globalThis.location.origin}/icons/icon-128.png`],
      },
      logger,
      /* Состояние подключений содержит ключи шифрования обмена
         с приложениями, поэтому хранится зашифрованным и исчезает
         вместе с кошельком. */
      storage: new SecureSessionStorage(secureStorage, logger),
    }),
    logger,
    getAddresses: () => session.getSnapshot().accounts.map((account) => account.address),
    getActiveChainId: () => session.getSnapshot().activeNetwork?.chainId ?? null,
    getAvailableChainIds: () => session.getSnapshot().networks.map((network) => network.chainId),
    execute: (request) => session.executeDappRequest(request),
    preflight: (request) => session.checkDappRequest(request),
  })
}

/**
 * Справочник пользователей на Fastify.
 *
 * В тестах не подключается: иначе `importWallet` ходил бы на живой сервер.
 * Пустой base URL шлёт `POST /v1/users` на тот же origin — Vite проксирует на 8080.
 */
function createUserDirectory(logger: ConsoleLogger) {
  if (import.meta.env.MODE === 'test') {
    return undefined
  }

  const configured = import.meta.env.VITE_SERVER_URL?.trim() ?? ''

  return new RemoteUserDirectory({ baseUrl: configured, logger })
}

/**
 * Источник курсов.
 *
 * ПОДКЛЮЧЁН, НО НЕ ВКЛЮЧЁН. Объект создаётся всегда, а обращения к нему
 * не происходит, пока пользователь не дал явного согласия: запрос курса
 * называет сервису адрес контракта, то есть сообщает состав портфеля.
 * Согласие хранится в настройках и спрашивается на экране портфеля
 * с перечислением того, что именно уйдёт наружу.
 *
 * РАЗМЕР ПАКЕТА ЗАВИСИТ ОТ КЛЮЧА. Бесплатный публичный доступ принимает
 * один адрес контракта за запрос — проверено обращением к живому
 * сервису, ответ `10012`. С ключом демонстрационного доступа предел
 * выше, и адреса уходят пакетами: меньше запросов означает и меньше
 * следов, и меньший расход лимита.
 */
/**
 * Учётные данные Tenderly из окружения сборки.
 *
 * ЧИТАЮТСЯ ЗДЕСЬ, А НЕ В ЯДРЕ. `import.meta.env` — особенность сборщика;
 * ядро обязано собираться и там, где его нет, — в тестах и в служебном
 * процессе расширения.
 *
 * ЭТО ПУТЬ ДЛЯ ПРОВЕРКИ НА СВОЕЙ МАШИНЕ. Значение из `.env` попадает
 * в текст выложенной программы и достаётся каждому, кто её открыл;
 * ключ доступа при этом даёт право тратить квоту проекта. Поэтому
 * введённые владельцем данные из зашифрованного хранилища перекрывают
 * эти, а не наоборот.
 *
 * `null` — рабочее состояние: следствия транзакции считает узел.
 */
function readTenderlyCredentials(): ITenderlyCredentials | null {
  const account = import.meta.env.VITE_TENDERLY_ACCOUNT ?? ''
  const project = import.meta.env.VITE_TENDERLY_PROJECT ?? ''
  const accessKey = import.meta.env.VITE_TENDERLY_ACCESS_KEY ?? ''

  /* Все три либо ничего: двух значений из трёх достаточно для запроса,
     который заведомо получит отказ. */
  if (account === '' || project === '' || accessKey === '') {
    return null
  }

  return { account, project, accessKey }
}

function createPriceProvider(): CoinGeckoPriceProvider {
  const apiKey = import.meta.env.VITE_COINGECKO_API_KEY ?? null
  const hasKey = apiKey !== null && apiKey !== ''

  return new CoinGeckoPriceProvider({
    ...(hasKey ? { apiKey } : {}),
    contractBatchSize: hasKey ? 25 : 1,
  })
}

/**
 * Источники истории переводов в порядке предпочтения.
 *
 * ИНДЕКСАТОР ПОДКЛЮЧАЕТСЯ ТОЛЬКО ПРИ НАЛИЧИИ КЛЮЧА, и это не техническое
 * следствие, а осознанный порядок.
 *
 * Индексатор — единственный способ увидеть переводы нативной валюты:
 * они не порождают событий, и в журналах узла их нет физически. Но за
 * это он получает адрес пользователя и возвращает всю его финансовую
 * историю разом — размер портфеля, контрагентов, время каждой операции.
 * Обычный RPC-узел видит только те запросы, которые ему шлют.
 *
 * Поэтому без явно указанного ключа кошелёк работает на разборе журналов:
 * история получается неполной, но ни один сторонний сервис не узнаёт,
 * чей это адрес и что на нём происходило. Неполнота при этом показывается
 * пользователю, а не замалчивается.
 */
function createHistoryProviders() {
  const apiKey = import.meta.env.VITE_ALCHEMY_API_KEY ?? null
  const useIndexer = apiKey !== null && apiKey !== ''

  return useIndexer
    ? [new AlchemyHistoryProvider(), new LogScanHistoryProvider()]
    : [new LogScanHistoryProvider()]
}

/**
 * Источники RPC-адресов в порядке предпочтения.
 *
 * ПОРЯДОК — ЭТО ПОЛИТИКА, И ОНА ЗАДАЁТСЯ ЗДЕСЬ, а не внутри механизма
 * перебора:
 *
 * 1. Собственный узел пользователя. Выбран сознательно и единственный
 *    не раскрывает адреса постороннему оператору.
 * 2. Alchemy — значение по умолчанию, когда пользователь ничего не указал.
 * 3. Публичные узлы из конфигурации сети — работают без ключа.
 *
 * КЛЮЧ ALCHEMY БЕРЁТСЯ ИЗ ОКРУЖЕНИЯ И ПУБЛИЧЕН. Vite подставляет значения
 * `VITE_*` прямо в бандл: ключ увидит каждый, кто откроет исходники
 * страницы. Ограничение по домену в панели Alchemy обязательно —
 * см. `.env.example`.
 *
 * БЕЗ КЛЮЧА ALCHEMY НЕ ДАЁТ НИ ОДНОГО АДРЕСА, и кошелёк работает
 * на публичных узлах. Это рабочее состояние, а не отказ.
 */
function createRpcProviders(secureStorage: SecureStorage) {
  const apiKey = import.meta.env.VITE_ALCHEMY_API_KEY ?? null

  return [
    new CustomRpcProvider(secureStorage),
    new AlchemyProvider({ apiKey }),
    new PublicRpcProvider(),
  ]
}

/**
 * Подключение аппаратного кошелька.
 *
 * СОЕДИНЕНИЕ ОТКРЫВАЕТСЯ НА КАЖДУЮ ОПЕРАЦИЮ И НЕ КЭШИРУЕТСЯ. Устройство
 * вынимают из разъёма когда угодно, а разрешение браузера действует
 * на выбранное устройство, а не навсегда: держать соединение открытым
 * значило бы обещать доступ, которого может уже не быть, и узнавать
 * об этом в середине подписи.
 *
 * Библиотека соединения загружается отдельным модулем: она нужна
 * единицам, а весит достаточно, чтобы её не тащить всем.
 */
async function connectLedger(): Promise<IHardwareDevice> {
  const { WebHidTransport } = await import('@/features/hardware')

  return new LedgerDevice(await WebHidTransport.connect())
}
