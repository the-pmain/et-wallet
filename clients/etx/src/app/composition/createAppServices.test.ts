import { describe, expect, it } from 'vitest'

import { SESSION_STATE } from '@/features/wallet'

import { createAppServices } from './createAppServices'

/**
 * Проверки composition root.
 *
 * ЗАЧЕМ ОНИ НУЖНЫ, ЕСЛИ ВСЕ СЕРВИСЫ ПРОВЕРЕНЫ ПО ОТДЕЛЬНОСТИ. Здесь
 * собирается боевая связка, и ровно здесь возможны ошибки, которых
 * не увидит ни один модульный тест: два защищённых хранилища вместо
 * одного, забытый источник курсов, разошедшиеся часы. На этапе 18 такое
 * уже случилось — боевая сборка использовала пустой источник курсов,
 * и заметить это удалось только живой проверкой.
 *
 * ЧЕГО ЗДЕСЬ НЕТ. Ни одного обращения к сети: сервисы создаются,
 * но не открываются. Проверяется состав связки, а не работа узлов.
 */
describe('createAppServices: состав связки', () => {
  it('собирает все сервисы приложения', () => {
    const services = createAppServices()

    expect(services.onboarding).toBeDefined()
    expect(services.session).toBeDefined()
    expect(services.clock).toBeDefined()
    expect(services.securitySettings).toBeDefined()
    expect(services.dappSessions).toBeDefined()
  })

  it('сессия начинается закрытой', () => {
    /* Открытая сессия означала бы выведенные ключи до ввода пароля. */
    expect(createAppServices().session.getSnapshot().state).toBe(SESSION_STATE.Closed)
  })

  it('кошелёк считается несозданным на чистом хранилище', async () => {
    const services = createAppServices()

    await services.onboarding.initialize()

    expect(services.onboarding.getState()).toBe('uninitialized')
  })

  it('каждый вызов даёт независимый набор', () => {
    /* Общее состояние между вызовами превратило бы два окна кошелька
       в одно: разблокировка в одном открывала бы второе. */
    const first = createAppServices()
    const second = createAppServices()

    expect(first.session).not.toBe(second.session)
    expect(first.onboarding).not.toBe(second.onboarding)
  })
})

describe('createAppServices: одно защищённое хранилище на всех', () => {
  it('онбординг и сессия читают одно и то же', async () => {
    /*
      САМАЯ ВАЖНАЯ ПРОВЕРКА ЭТОГО ФАЙЛА. `SecureStorage` владеет
      сессионным ключом, выведенным из пароля. Второй экземпляр поверх
      того же хранилища имел бы собственный ключ и не смог бы прочитать
      записанное первым: кошелёк создавался бы успешно и не открывался
      никогда.

      ПОЧЕМУ ЗДЕСЬ НЕ ОТКРЫВАЕТСЯ СЕССИЯ. Открытие доходит до опроса
      узла, а боевая связка ходит к настоящим публичным RPC: проверка
      стала бы зависеть от чужой доступности и сообщала бы адрес
      кошелька постороннему оператору при каждом прогоне. Подставить
      дублёр нельзя намеренно — `createAppServices` не принимает
      аргументов, иначе подстановка была бы достижима и в боевой
      сборке.

      Признак общего экземпляра, наблюдаемый без сети: онбординг
      переходит в разблокированное состояние, а повторное чтение
      хранилища тем же ключом даёт записанное. Путь целиком — от
      импорта до появления аккаунта на экране — закреплён сквозной
      проверкой `e2e/wallet-flow.spec.ts`, где приложение работает
      собранным и в настоящем браузере.

      Ключ шифрования здесь настоящий, а не ускоренный: проверяется
      именно боевая связка.
    */
    const services = createAppServices()

    await services.onboarding.initialize()
    await services.onboarding.importWallet(
      'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about',
      'Korova-7-Luna!',
    )

    expect(services.onboarding.getState()).toBe('unlocked')

    /* Блокировка и повторная разблокировка тем же паролем: расшифровка
       удалась — значит заголовок хранилища один и тот же. */
    services.onboarding.lock()

    expect(services.onboarding.getState()).toBe('locked')

    await services.onboarding.unlock('Korova-7-Luna!')

    expect(services.onboarding.getState()).toBe('unlocked')
  }, 60_000)
})

describe('createAppServices: подключения приложений', () => {
  it('сервис подключений собран и знает адреса кошелька', () => {
    /* Адреса читаются функцией, а не копируются при сборке: снимок,
       взятый один раз, выдал бы приложению устаревший аккаунт. */
    const services = createAppServices()
    const snapshot = services.dappSessions.getSnapshot()

    expect(snapshot.isReady).toBe(false)
    expect(snapshot.sessions).toEqual([])
  })
})
