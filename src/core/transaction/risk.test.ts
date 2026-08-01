import { describe, expect, it } from 'vitest'

import { DEAD_ADDRESS, toAddress, ZERO_ADDRESS } from '@/core/address'
import type { Address } from '@/core/types'

import { RECIPIENT_RISK, findRecipientRisks } from './risk'

const SENDER = toAddress('0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed')
const PEER = toAddress('0xfB6916095ca1df60bB79Ce92cE3Ea74c37c5d359')

describe('findRecipientRisks', () => {
  it('не находит замечаний у обычного адреса с контрольной суммой', () => {
    expect(findRecipientRisks(PEER, SENDER)).toHaveLength(0)
  })

  it('предупреждает об адресе сжигания', () => {
    /* Средства уйдут безвозвратно: получить их не сможет никто. */
    expect(findRecipientRisks(ZERO_ADDRESS, SENDER)).toContain(RECIPIENT_RISK.BurnAddress)
  })

  it('предупреждает о переводе самому себе', () => {
    expect(findRecipientRisks(SENDER, SENDER)).toContain(RECIPIENT_RISK.SelfTransfer)
  })

  it('замечает перевод себе независимо от регистра записи', () => {
    const lowercase = SENDER.toLowerCase() as Address

    expect(findRecipientRisks(lowercase, SENDER)).toContain(RECIPIENT_RISK.SelfTransfer)
  })

  it('предупреждает об адресе без контрольной суммы', () => {
    /* Контрольная сумма выражена регистром букв: адрес целиком
       в нижнем регистре её не несёт, и опечатка не обнаруживается. */
    const lowercase = PEER.toLowerCase() as Address

    expect(findRecipientRisks(lowercase, SENDER)).toContain(RECIPIENT_RISK.NoChecksum)
  })

  it('предупреждает об адресе целиком в верхнем регистре', () => {
    const uppercase = `0x${PEER.slice(2).toUpperCase()}` as Address

    expect(findRecipientRisks(uppercase, SENDER)).toContain(RECIPIENT_RISK.NoChecksum)
  })

  it('не предупреждает об адресе из одних цифр', () => {
    /* Такой адрес неотличим от записанного с контрольной суммой:
       требовать иного значило бы предупреждать без причины, а ложная
       тревога приучает не читать предупреждения. */
    const digitsOnly = `0x${'1234567890'.repeat(4)}` as Address

    expect(findRecipientRisks(digitsOnly, SENDER)).not.toContain(RECIPIENT_RISK.NoChecksum)
  })

  it('находит несколько замечаний сразу', () => {
    /* Адрес сжигания `0x…dEaD`, записанный в нижнем регистре: и уход
       средств в никуда, и отсутствие контрольной суммы. */
    const risks = findRecipientRisks(DEAD_ADDRESS.toLowerCase(), SENDER)

    expect(risks).toContain(RECIPIENT_RISK.BurnAddress)
    expect(risks).toContain(RECIPIENT_RISK.NoChecksum)
  })
})
