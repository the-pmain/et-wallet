import { SigningKey, Transaction, computeAddress, getBytes, hashMessage } from 'ethers'
import { beforeEach, describe, expect, it } from 'vitest'

import { toAddress } from '@/core/address'
import { SecureStorage } from '@/core/encryption'
import { HDWalletService } from '@/core/hdwallet'
import type { IHardwareAddress, IHardwareDevice } from '@/core/hardware'
import { KEYRING_TYPE } from '@/core/keyring'
import { MnemonicService } from '@/core/mnemonic'
import { toChainId, toWei } from '@/core/types'
import type { Address, DerivationPath, HexString } from '@/core/types'
import { TRANSACTION_TYPE, type ISignableTransaction, type ITypedData } from '@/core/transaction'
import {
  FakeClock,
  FastEncryptionService,
  InMemoryStorageService,
  NullLogger,
} from '@/test/doubles'

import { AccountManager } from './AccountManager'

const PASSWORD = 'правильный-пароль-1234'

const TEST_MNEMONIC =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'

/** Ключ, который «лежит в устройстве». */
const DEVICE_KEY = new SigningKey(`0x${'07'.repeat(32)}`)
const DEVICE_ADDRESS = toAddress(computeAddress(DEVICE_KEY.publicKey))

/** Ключ другого устройства: та же позиция, другая seed-фраза. */
const OTHER_KEY = new SigningKey(`0x${'09'.repeat(32)}`)
const OTHER_ADDRESS = toAddress(computeAddress(OTHER_KEY.publicKey))

const PATH = "m/44'/60'/0'/0/0" as DerivationPath
const RECIPIENT = toAddress('0xfB6916095ca1df60bB79Ce92cE3Ea74c37c5d359')

/**
 * Устройство-дублёр.
 *
 * Подписывает настоящим ключом: проверяется путь от менеджера аккаунтов
 * до готовой подписи целиком, а не то, что вызов дошёл.
 */
class FakeDevice implements IHardwareDevice {
  /** Ключ, которым отвечает устройство. Подменяется в проверках. */
  key = DEVICE_KEY

  /** Сколько раз запрашивался адрес: сверка перед подписью обязана быть. */
  addressReads = 0

  getAddress(path: DerivationPath): Promise<IHardwareAddress> {
    this.addressReads += 1

    return Promise.resolve({ address: toAddress(computeAddress(this.key.publicKey)), path })
  }

  signTransaction(_path: DerivationPath, transaction: ISignableTransaction): Promise<HexString> {
    const unsigned = Transaction.from({
      type: 2,
      chainId: transaction.chainId,
      to: transaction.to,
      nonce: transaction.nonce,
      gasLimit: transaction.gasLimit,
      value: transaction.value,
      data: transaction.data,
      maxFeePerGas: transaction.maxFeePerGas,
      maxPriorityFeePerGas: transaction.maxPriorityFeePerGas,
    })

    unsigned.signature = this.key.sign(unsigned.unsignedHash)

    return Promise.resolve(unsigned.serialized as HexString)
  }

  signMessage(_path: DerivationPath, message: Uint8Array): Promise<HexString> {
    return Promise.resolve(
      this.key.sign(hashMessage(Uint8Array.from(message))).serialized as HexString,
    )
  }

  signTypedData(): Promise<HexString> {
    return Promise.resolve(this.key.sign(`0x${'11'.repeat(32)}`).serialized as HexString)
  }
}

const TRANSACTION: ISignableTransaction = {
  type: TRANSACTION_TYPE.Eip1559,
  chainId: toChainId(1n),
  from: DEVICE_ADDRESS,
  to: RECIPIENT,
  value: toWei(10n ** 18n),
  data: '0x' as HexString,
  nonce: 0,
  gasLimit: 21_000n,
  maxFeePerGas: 30_000_000_000n,
  maxPriorityFeePerGas: 1_000_000_000n,
  gasPrice: null,
}

const TYPED_DATA: ITypedData = {
  domain: { name: 'Test', version: '1', chainId: toChainId(1n), verifyingContract: RECIPIENT },
  types: {
    EIP712Domain: [
      { name: 'name', type: 'string' },
      { name: 'version', type: 'string' },
      { name: 'chainId', type: 'uint256' },
      { name: 'verifyingContract', type: 'address' },
    ],
    Message: [{ name: 'amount', type: 'uint256' }],
  },
  primaryType: 'Message',
  message: { amount: 1n },
}

let manager: AccountManager
let device: FakeDevice

/** HD-дерево из тестовой фразы. Требуется менеджеру при сборке. */
async function createHdWallet(): Promise<HDWalletService> {
  const mnemonicService = new MnemonicService()
  const mnemonic = mnemonicService.fromPhrase(TEST_MNEMONIC)
  const seed = await mnemonicService.toSeed(mnemonic)

  mnemonic.wipe()

  const wallet = HDWalletService.fromSeed(seed)

  seed.wipe()

  return wallet
}

beforeEach(async () => {
  const secure = new SecureStorage(new InMemoryStorageService(), new FastEncryptionService())

  await secure.initialize(PASSWORD)

  /* Дерево нужно только для того, чтобы менеджер завёлся: аппаратные
     аккаунты к нему не относятся. */
  const hdWallet = await createHdWallet()

  device = new FakeDevice()

  manager = AccountManager.create({
    hdWallet,
    secureStorage: secure,
    clock: new FakeClock(),
    logger: new NullLogger(),
    connectHardware: () => Promise.resolve(device),
  })

  await manager.init()
})

/** Добавляет аккаунт устройства и возвращает его. */
async function addDeviceAccount(address: Address = DEVICE_ADDRESS) {
  return await manager.addHardwareAccount({
    type: KEYRING_TYPE.Ledger,
    address,
    path: PATH,
  })
}

describe('Аккаунт аппаратного кошелька', () => {
  it('хранит адрес и путь, но не индекс в нашем дереве', async () => {
    /* Дерево живёт в устройстве: индекс у нас означал бы, что мы
       умеем выводить его ключи, а мы не умеем. */
    const account = await addDeviceAccount()

    expect(account.source).toBe(KEYRING_TYPE.Ledger)
    expect(account.address).toBe(DEVICE_ADDRESS)
    expect(account.derivationPath).toBe(PATH)
    expect(account.addressIndex).toBeNull()
  })

  it('приватный ключ выдать невозможно', async () => {
    /* Не потому, что мы запретили, а потому, что его у нас нет. */
    const account = await addDeviceAccount()

    await expect(
      manager.exportPrivateKey(account.id, PASSWORD, {
        matches: () => true,
        consume: () => undefined,
      } as never),
    ).rejects.toThrow()
  })

  it('повторное добавление того же адреса отвергается', async () => {
    await addDeviceAccount()

    await expect(addDeviceAccount()).rejects.toThrow(/already/i)
  })
})

describe('Подпись аппаратным аккаунтом', () => {
  it('транзакция подписывается ключом устройства', async () => {
    const account = await addDeviceAccount()
    const signed = await manager.signTransaction(account.id, TRANSACTION)

    expect(Transaction.from(signed.raw).from).toBe(DEVICE_ADDRESS)
  })

  it('хэш подписанной транзакции совпадает с тем, что даст сеть', async () => {
    /* По этому хэшу кошелёк следит за судьбой отправки. Разойдись он
       с настоящим — операция навсегда осталась бы «ожидающей». */
    const account = await addDeviceAccount()
    const signed = await manager.signTransaction(account.id, TRANSACTION)

    expect(signed.hash).toBe(Transaction.from(signed.raw).hash)
  })

  it('сообщение подписывается и восстанавливается в адрес устройства', async () => {
    const account = await addDeviceAccount()
    const message = 'Sign in to Example'
    const signature = await manager.signMessage(account.id, message)

    const { recoverAddress } = await import('ethers')

    expect(toAddress(recoverAddress(hashMessage(message), signature))).toBe(DEVICE_ADDRESS)
  })

  it('структура для чужой сети до устройства не доходит', async () => {
    /* Устройство получает два готовых хэша и домен проверить уже
       не может: сверка обязана произойти здесь. */
    const account = await addDeviceAccount()

    await expect(manager.signTypedData(account.id, TYPED_DATA, toChainId(137n))).rejects.toThrow()
  })
})

describe('Защита от чужого устройства', () => {
  it('адрес сверяется перед каждой подписью', async () => {
    const account = await addDeviceAccount()

    await manager.signTransaction(account.id, TRANSACTION)

    expect(device.addressReads).toBeGreaterThan(0)
  })

  it('подключённое чужое устройство подписать не даёт', async () => {
    /* У другой seed-фразы по тому же пути лежит другой ключ. Подпиши
       мы вслепую — средства ушли бы с адреса, которого человек
       на экране не видел, а показанный остался бы нетронутым. */
    const account = await addDeviceAccount()

    device.key = OTHER_KEY

    await expect(manager.signTransaction(account.id, TRANSACTION)).rejects.toThrow(
      /different address/i,
    )
  })

  it('подпись отвергается до обращения к устройству за ней', async () => {
    /* Отказ обязан наступить раньше, чем человек начнёт нажимать
       кнопки: иначе он подтвердит операцию, которая всё равно
       не состоится. */
    const account = await addDeviceAccount(OTHER_ADDRESS)

    await expect(manager.signMessage(account.id, 'anything')).rejects.toThrow(/different address/i)
  })
})

describe('Сборка без поддержки устройств', () => {
  it('подпись отвергается внятно, а не падением', async () => {
    const secure = new SecureStorage(new InMemoryStorageService(), new FastEncryptionService())

    await secure.initialize(PASSWORD)

    const hdWallet = await createHdWallet()

    const plain = AccountManager.create({
      hdWallet,
      secureStorage: secure,
      clock: new FakeClock(),
      logger: new NullLogger(),
    })

    await plain.init()

    const account = await plain.addHardwareAccount({
      type: KEYRING_TYPE.Ledger,
      address: DEVICE_ADDRESS,
      path: PATH,
    })

    await expect(plain.signTransaction(account.id, TRANSACTION)).rejects.toThrow()
  })
})

describe('Байты, уходящие на устройство', () => {
  it('на подпись уходит та же транзакция, что показана', async () => {
    /* Менеджер не пересчитывает поля: показанное и подписанное
       обязаны совпадать. */
    const account = await addDeviceAccount()
    const signed = await manager.signTransaction(account.id, TRANSACTION)
    const parsed = Transaction.from(signed.raw)

    expect(parsed.to).toBe(RECIPIENT)
    expect(parsed.value).toBe(TRANSACTION.value)
    expect(parsed.nonce).toBe(TRANSACTION.nonce)
    expect(getBytes(parsed.data)).toHaveLength(0)
  })
})
