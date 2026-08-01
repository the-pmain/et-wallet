import { beforeEach, describe, expect, it } from 'vitest'

import { toAddress } from '@/core/address'
import { BUILT_IN_CHAIN_ID, BUILT_IN_NETWORKS } from '@/core/network'
import type { INetworkConfig, INetworkService } from '@/core/network'
import type { IProvider, IProviderResolver } from '@/core/provider'
import type { ChainId } from '@/core/types'
import { FakeClock, FakeProviderFactory, NullLogger, type IFakeEnsRecord } from '@/test/doubles'

import { EnsService } from './EnsService'

const OWNER = toAddress('0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045')
const OTHER = toAddress('0xfB6916095ca1df60bB79Ce92cE3Ea74c37c5d359')

/** Сеть по идентификатору. Берётся из встроенного списка, а не сочиняется. */
function networkOf(chainId: ChainId): INetworkConfig {
  const found = BUILT_IN_NETWORKS.find((network) => network.chainId === chainId)

  if (found === undefined) {
    throw new Error(`Встроенной сети ${chainId.toString()} нет.`)
  }

  return found
}

/** Служба сетей-дублёр: отдаёт заданную активную сеть. */
function fakeNetworks(active: INetworkConfig): INetworkService {
  return {
    getActive: () => active,
    list: () => BUILT_IN_NETWORKS,
  } as unknown as INetworkService
}

let factory: FakeProviderFactory
let clock: FakeClock

/** Собирает сервис поверх дублёра с заданными записями ENS. */
function createService(records: readonly IFakeEnsRecord[], chainId = BUILT_IN_CHAIN_ID.Ethereum) {
  factory = new FakeProviderFactory()
  factory.configure({ ensRecords: records })

  const network = networkOf(chainId)

  /* Резолвер провайдеров создаёт соединение один раз и переиспользует:
     иначе счётчик обращений к узлу считал бы не запросы, а соединения. */
  let provider: IProvider | null = null

  const resolver: IProviderResolver = {
    get: async () => {
      provider ??= await factory.create(network)

      return provider
    },
  }

  return new EnsService({
    resolver,
    networks: fakeNetworks(network),
    clock,
    logger: new NullLogger(),
  })
}

beforeEach(() => {
  clock = new FakeClock(1_700_000_000_000)
})

describe('EnsService: поддерживаемые сети', () => {
  it('работает в Ethereum', () => {
    expect(createService([]).isSupported(BUILT_IN_CHAIN_ID.Ethereum)).toBe(true)
  })

  it.each([BUILT_IN_CHAIN_ID.Polygon, BUILT_IN_CHAIN_ID.Base, BUILT_IN_CHAIN_ID.Arbitrum])(
    'не работает в сети %s',
    (chainId) => {
      expect(createService([]).isSupported(chainId)).toBe(false)
    },
  )

  it('в другой сети имя не разрешается вовсе', async () => {
    /* Открывать второе соединение с узлом Ethereum значило бы сообщить
       постороннему оператору, что и с какого адреса ищет пользователь,
       находящийся, как он считает, в другой сети. */
    const service = createService(
      [{ name: 'vitalik.eth', address: OWNER }],
      BUILT_IN_CHAIN_ID.Polygon,
    )

    await expect(service.resolveName('vitalik.eth')).resolves.toBeNull()
  })
})

describe('EnsService: прямое разрешение', () => {
  it('разрешает имя в адрес', async () => {
    const service = createService([{ name: 'vitalik.eth', address: OWNER }])

    await expect(service.resolveName('vitalik.eth')).resolves.toEqual({
      name: 'vitalik.eth',
      displayName: 'vitalik.eth',
      isAscii: true,
      address: OWNER,
    })
  })

  it('снимает регистр перед хэшированием', async () => {
    const service = createService([{ name: 'vitalik.eth', address: OWNER }])

    await expect(service.resolveName('Vitalik.ETH')).resolves.toMatchObject({ address: OWNER })
  })

  it('незарегистрированное имя даёт null', async () => {
    const service = createService([{ name: 'vitalik.eth', address: OWNER }])

    await expect(service.resolveName('nobody.eth')).resolves.toBeNull()
  })

  it('запись с нулевым адресом даёт null, а не адрес сжигания', async () => {
    /* Приняв ноль за получателя, кошелёк отправил бы средства туда,
       откуда их не достанет никто. */
    const service = createService([{ name: 'empty.eth', address: null }])

    await expect(service.resolveName('empty.eth')).resolves.toBeNull()
  })

  it('имя, не прошедшее нормализацию, даёт null без запроса к узлу', async () => {
    /* Смешение письменностей отвергается ещё до обращения к сети:
       спрашивать узел про заведомо непригодное имя незачем. */
    const service = createService([{ name: 'vitalik.eth', address: OWNER }])

    await expect(
      service.resolveName(`vit${String.fromCodePoint(0x0430)}lik.eth`),
    ).resolves.toBeNull()
    expect(factory.createdCount).toBe(0)
  })

  it('разрешает имя с эмодзи', async () => {
    /* Полная нормализация ENSIP-15: имя законно и обязано работать. */
    const service = createService([{ name: '\u{1F600}.eth', address: OWNER }])

    await expect(service.resolveName('\u{1F600}.eth')).resolves.toMatchObject({
      address: OWNER,
      displayName: '\u{1F600}\u{FE0F}.eth',
      isAscii: false,
    })
  })
})

describe('EnsService: обратное разрешение', () => {
  it('возвращает имя, подтверждённое прямым разрешением', async () => {
    const service = createService([{ name: 'vitalik.eth', address: OWNER, reverseFor: OWNER }])

    await expect(service.lookupAddress(OWNER)).resolves.toMatchObject({ name: 'vitalik.eth' })
  })

  it('отвергает имя, указывающее на другой адрес', async () => {
    /* САМАЯ ВАЖНАЯ ПРОВЕРКА МОДУЛЯ. Обратную запись задаёт владелец
       адреса, и объявить себя `vitalik.eth` вправе кто угодно. Показав
       её без сверки, кошелёк подписал бы подделку своим интерфейсом. */
    const service = createService([{ name: 'vitalik.eth', address: OWNER, reverseFor: OTHER }])

    await expect(service.lookupAddress(OTHER)).resolves.toBeNull()
  })

  it('отвергает имя, у которого нет прямой записи', async () => {
    const service = createService([{ name: 'vitalik.eth', address: null, reverseFor: OTHER }])

    await expect(service.lookupAddress(OTHER)).resolves.toBeNull()
  })

  it('адрес без обратной записи даёт null', async () => {
    const service = createService([{ name: 'vitalik.eth', address: OWNER }])

    await expect(service.lookupAddress(OWNER)).resolves.toBeNull()
  })

  it('не зависит от регистра адреса', async () => {
    const service = createService([
      { name: 'vitalik.eth', address: OWNER, reverseFor: OWNER.toLowerCase() },
    ])

    await expect(service.lookupAddress(OWNER)).resolves.toMatchObject({ name: 'vitalik.eth' })
  })
})

describe('EnsService: кэш', () => {
  it('повторный запрос не создаёт нового соединения', async () => {
    const service = createService([{ name: 'vitalik.eth', address: OWNER }])

    await service.resolveName('vitalik.eth')
    const afterFirst = factory.createdCount

    await service.resolveName('vitalik.eth')

    expect(factory.createdCount).toBe(afterFirst)
  })

  it('запоминает отсутствие записи', async () => {
    /* Поле ввода обращается к сервису на каждое нажатие клавиши,
       и недописанное имя — самый частый запрос. */
    const service = createService([])

    await expect(service.resolveName('nobody.eth')).resolves.toBeNull()
    await expect(service.resolveName('nobody.eth')).resolves.toBeNull()

    expect(factory.createdCount).toBe(1)
  })

  it('устаревшая запись перечитывается', async () => {
    const service = createService([{ name: 'vitalik.eth', address: OWNER }])

    await service.resolveName('vitalik.eth')

    clock.advance(6 * 60 * 1000)
    factory.configure({ ensRecords: [{ name: 'vitalik.eth', address: OTHER }] })

    await expect(service.resolveName('vitalik.eth')).resolves.toMatchObject({ address: OTHER })
  })

  it('сброс кэша заставляет спросить узел заново', async () => {
    const service = createService([{ name: 'vitalik.eth', address: OWNER }])

    await service.resolveName('vitalik.eth')
    service.clearCache()
    factory.configure({ ensRecords: [{ name: 'vitalik.eth', address: OTHER }] })

    await expect(service.resolveName('vitalik.eth')).resolves.toMatchObject({ address: OTHER })
  })
})
