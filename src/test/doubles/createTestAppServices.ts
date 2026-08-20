import { MemoryStorageService, SecureStorage, type IProviderFactory } from '@/core'
import { DappSessionService } from '@/features/dapp'
import { bytesToHex } from '@noble/hashes/utils.js'

import { getRandomBytes } from '@/core'
import { OnboardingService, WalletBroadcast } from '@/features/onboarding'
import { SecuritySettingsRepository } from '@/features/security'
import { WalletSession } from '@/features/wallet'

import { FakeClock } from './FakeClock'
import { FakeSessionTransport } from './FakeSessionTransport'
import { FakePriceProvider } from './FakePriceProvider'
import { FakeProviderFactory } from './FakeProviderFactory'
import { FastEncryptionService } from './FastEncryptionService'
import { NullLogger } from './NullLogger'

/** Сервисы приложения, собранные для теста. */
export interface ITestAppServices {
  readonly onboarding: OnboardingService

  /**
   * Канал оповещения между вкладками.
   *
   * В проверках он настоящий: `BroadcastChannel` есть и в jsdom,
   * и в Node. Подменять его дублёром значило бы проверять дублёр.
   */
  readonly broadcast: WalletBroadcast

  /**
   * Имя канала, своё у каждого набора сервисов.
   *
   * ИЗОЛЯЦИЯ ОБЯЗАТЕЛЬНА. `BroadcastChannel` в Node доставляет
   * сообщения между рабочими потоками одного процесса, а проверки идут
   * параллельно. С общим именем сообщение о стирании из одной проверки
   * закрывало бы кошелёк во всех остальных — что и произошло при первом
   * прогоне: упала проверка ограничителя попыток, к вкладкам отношения
   * не имеющая.
   */
  readonly broadcastName: string
  readonly session: WalletSession
  readonly providerFactory: FakeProviderFactory
  readonly priceProvider: FakePriceProvider
  readonly clock: FakeClock
  readonly securitySettings: SecuritySettingsRepository
  readonly dappSessions: DappSessionService
  readonly dappTransport: FakeSessionTransport
  readonly logger: NullLogger

  /**
   * Незашифрованное хранилище — то самое, поверх которого работает
   * защищённое.
   *
   * Отдаётся наружу ради проверок безопасности: убедиться, что секрет
   * не лежит открытым текстом, можно только заглянув в сырые записи.
   */
  readonly storage: MemoryStorageService

  /** Защищённое хранилище. Одно на онбординг и сессию, как в бою. */
  readonly secureStorage: SecureStorage
}

/**
 * Повторяет composition root приложения на дублёрах.
 *
 * ПОЧЕМУ НЕ ПАРАМЕТРИЗУЕТСЯ БОЕВАЯ СБОРКА. Возможность подставить в
 * `createAppServices` ускоренное шифрование или поддельный узел означала бы,
 * что такая подстановка достижима и в production-сборке. Дублёры остаются
 * в тестовом коде, а совпадение структуры проверяется тем, что оба варианта
 * собирают одни и те же классы.
 *
 * ХРАНИЛИЩЕ ОДНО НА ОБА СЕРВИСА — как и в боевой сборке: онбординг пишет
 * мнемоническую фразу, сессия читает её той же сессией дешифрования.
 */
export function createTestAppServices(): ITestAppServices {
  const storage = new MemoryStorageService()
  const secureStorage = new SecureStorage(storage, new FastEncryptionService())
  const clock = new FakeClock(1_700_000_000_000)
  const logger = new NullLogger()
  const providerFactory = new FakeProviderFactory()

  /* Источник курсов подставляется всегда, но опрашивается только после
     согласия пользователя: счётчик обращений позволяет проверить, что
     до согласия к нему не обращались ни разу. */
  const priceProvider = new FakePriceProvider()

  const session = new WalletSession({
    secureStorage,
    storage,
    clock,
    logger,
    providerFactory: providerFactory satisfies IProviderFactory,
    priceProvider,
  })

  /* Транспорт подключений подменён дублёром: настоящий требует ключа
     стороннего сервиса и живого relay, а проверять надо решения
     кошелька, а не чужой сервер. */
  const dappTransport = new FakeSessionTransport()

  /* Имя уникально: см. пояснение к `broadcastName`. */
  const broadcastName = `etwallet-test-${bytesToHex(getRandomBytes(8))}`
  const broadcast = new WalletBroadcast(broadcastName)

  return {
    onboarding: new OnboardingService({
      broadcast,
      secureStorage,
    }),
    session,
    broadcast,
    broadcastName,
    providerFactory,
    priceProvider,
    clock,
    securitySettings: new SecuritySettingsRepository(storage),
    dappTransport,
    storage,
    secureStorage,
    dappSessions: new DappSessionService({
      transport: dappTransport,
      logger,
      getAddresses: () => session.getSnapshot().accounts.map((account) => account.address),
      getActiveChainId: () => session.getSnapshot().activeNetwork?.chainId ?? null,
      getAvailableChainIds: () => session.getSnapshot().networks.map((network) => network.chainId),
      execute: (request) => session.executeDappRequest(request),
    }),
    logger,
  }
}
