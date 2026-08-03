import { describe, expect, it } from 'vitest'

import { toAddress } from '@/core/address'
import { BUILT_IN_CHAIN_ID, BUILT_IN_NETWORKS } from '@/core/network'

import { findVerifiedToken, isVerifiedToken, listVerifiedTokens } from './verified'

const USDC_ETHEREUM = toAddress('0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48')
const UNKNOWN = toAddress('0x1111111111111111111111111111111111111111')

describe('Поиск по списку', () => {
  it('находит известный контракт', () => {
    const token = findVerifiedToken(BUILT_IN_CHAIN_ID.Ethereum, USDC_ETHEREUM)

    expect(token?.symbol).toBe('USDC')
    expect(token?.decimals).toBe(6)
  })

  it('не различает регистр адреса', () => {
    /* Адрес приходит и с контрольной суммой, и без неё, а контракт
       различается байтами, а не написанием. */
    expect(
      isVerifiedToken(BUILT_IN_CHAIN_ID.Ethereum, toAddress(USDC_ETHEREUM.toLowerCase())),
    ).toBe(true)
  })

  it('тот же адрес в другой сети проверенным не считается', () => {
    /* Один и тот же адрес в разных сетях — разные контракты.
       Пометка, перенесённая между сетями, поручилась бы за чужой код. */
    expect(isVerifiedToken(BUILT_IN_CHAIN_ID.Polygon, USDC_ETHEREUM)).toBe(false)
  })

  it('незнакомый адрес не найден', () => {
    expect(findVerifiedToken(BUILT_IN_CHAIN_ID.Ethereum, UNKNOWN)).toBeNull()
  })
})

describe('Состав списка', () => {
  it('каждая встроенная сеть содержит хотя бы один проверенный контракт', () => {
    /* Сеть без проверенных контрактов оставляет владельца наедине
       со сверкой адресов вручную. */
    for (const network of BUILT_IN_NETWORKS) {
      expect(listVerifiedTokens(network.chainId).length).toBeGreaterThan(0)
    }
  })

  it('все записи принадлежат встроенным сетям', () => {
    const known = new Set(BUILT_IN_NETWORKS.map((network) => network.chainId))

    for (const network of BUILT_IN_NETWORKS) {
      for (const token of listVerifiedTokens(network.chainId)) {
        expect(known.has(token.chainId)).toBe(true)
      }
    }
  })

  it('адреса не повторяются внутри сети', () => {
    for (const network of BUILT_IN_NETWORKS) {
      const addresses = listVerifiedTokens(network.chainId).map((token) =>
        token.address.toLowerCase(),
      )

      expect(new Set(addresses).size).toBe(addresses.length)
    }
  })

  it('адреса записаны с контрольной суммой', () => {
    /* Запись без контрольной суммы не позволяет заметить опечатку
       при чтении кода — а список именно для того и нужен, чтобы
       адресам можно было доверять. */
    for (const network of BUILT_IN_NETWORKS) {
      for (const token of listVerifiedTokens(network.chainId)) {
        expect(token.address).toBe(toAddress(token.address))
      }
    }
  })

  it('число знаков задано и правдоподобно', () => {
    for (const network of BUILT_IN_NETWORKS) {
      for (const token of listVerifiedTokens(network.chainId)) {
        expect(Number.isInteger(token.decimals)).toBe(true)
        expect(token.decimals).toBeGreaterThanOrEqual(0)
        expect(token.decimals).toBeLessThanOrEqual(18)
      }
    }
  })
})

describe('Измеренные значения, а не память', () => {
  it('у стейблкоинов BNB Chain восемнадцать знаков', () => {
    /* Живая проверка: в отличие от Ethereum, где у USDT шесть знаков,
       мостовые версии на BNB Chain объявляют восемнадцать. Ошибка
       здесь исказила бы сумму в триллион раз. */
    const usdt = findVerifiedToken(
      BUILT_IN_CHAIN_ID.BnbChain,
      toAddress('0x55d398326f99059fF775485246999027B3197955'),
    )

    expect(usdt?.decimals).toBe(18)
  })

  it('мост Tether на Polygon отвечает символом USDT0', () => {
    /* Символ сменился вместе с переходом на USDT0. Вписанный по памяти
       «USDT» разошёлся бы с контрактом, и сверка перестала бы работать
       именно там, где она нужна. */
    const usdt = findVerifiedToken(
      BUILT_IN_CHAIN_ID.Polygon,
      toAddress('0xc2132D05D31c914a87C6611C10748AEb04B58e8F'),
    )

    expect(usdt?.symbol).toBe('USDT0')
  })

  it('на Avalanche символ записан со строчной буквой', () => {
    const usdt = findVerifiedToken(
      BUILT_IN_CHAIN_ID.Avalanche,
      toAddress('0x9702230A8Ea53601f5cD2dc00fDBc13d4dF4A8c7'),
    )

    expect(usdt?.symbol).toBe('USDt')
  })
})
