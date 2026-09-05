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

const PASSWORD = 'correct-password-1234'

const TEST_MNEMONIC =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'

/** Key that “sits in the device”. */
const DEVICE_KEY = new SigningKey(`0x${'07'.repeat(32)}`)
const DEVICE_ADDRESS = toAddress(computeAddress(DEVICE_KEY.publicKey))

/** Key of another device: same position, different seed phrase. */
const OTHER_KEY = new SigningKey(`0x${'09'.repeat(32)}`)
const OTHER_ADDRESS = toAddress(computeAddress(OTHER_KEY.publicKey))

const PATH = "m/44'/60'/0'/0/0" as DerivationPath
const RECIPIENT = toAddress('0xfB6916095ca1df60bB79Ce92cE3Ea74c37c5d359')

/**
 * Stand-in device.
 *
 * Signs with a real key: the path from the account manager to the
 * finished signature is checked whole, not merely that the call
 * arrived.
 */
class FakeDevice implements IHardwareDevice {
  /** Key the device replies with. Substituted in checks. */
  key = DEVICE_KEY

  /** How many times the address was asked: the pre-sign check must happen. */
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

/** HD tree from the test phrase. Required by the manager at assembly. */
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

  /* The tree is needed only so the manager starts: hardware
     accounts do not belong to it. */
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

/** Adds a device account and returns it. */
async function addDeviceAccount(address: Address = DEVICE_ADDRESS) {
  return await manager.addHardwareAccount({
    type: KEYRING_TYPE.Ledger,
    address,
    path: PATH,
  })
}

describe('Hardware-wallet account', () => {
  it('stores the address and path, but not an index in our tree', async () => {
    /* The tree lives in the device: an index on our side would
       mean we can derive its keys, and we cannot. */
    const account = await addDeviceAccount()

    expect(account.source).toBe(KEYRING_TYPE.Ledger)
    expect(account.address).toBe(DEVICE_ADDRESS)
    expect(account.derivationPath).toBe(PATH)
    expect(account.addressIndex).toBeNull()
  })

  it('the private key cannot be revealed', async () => {
    /* Not because we forbade it, but because we do not have it. */
    const account = await addDeviceAccount()

    await expect(
      manager.exportPrivateKey(account.id, PASSWORD, {
        matches: () => true,
        consume: () => undefined,
      } as never),
    ).rejects.toThrow()
  })

  it('adding the same address again is rejected', async () => {
    await addDeviceAccount()

    await expect(addDeviceAccount()).rejects.toThrow(/already/i)
  })
})

describe('Signing with a hardware account', () => {
  it('the transaction is signed with the device key', async () => {
    const account = await addDeviceAccount()
    const signed = await manager.signTransaction(account.id, TRANSACTION)

    expect(Transaction.from(signed.raw).from).toBe(DEVICE_ADDRESS)
  })

  it('the signed-transaction hash matches what the network will give', async () => {
    /* The wallet tracks the send by this hash. If it diverged from
       the real one, the operation would stay “pending” forever. */
    const account = await addDeviceAccount()
    const signed = await manager.signTransaction(account.id, TRANSACTION)

    expect(signed.hash).toBe(Transaction.from(signed.raw).hash)
  })

  it('a message is signed and recovers to the device address', async () => {
    const account = await addDeviceAccount()
    const message = 'Sign in to Example'
    const signature = await manager.signMessage(account.id, message)

    const { recoverAddress } = await import('ethers')

    expect(toAddress(recoverAddress(hashMessage(message), signature))).toBe(DEVICE_ADDRESS)
  })

  it('a structure for a foreign network does not reach the device', async () => {
    /* The device gets two ready hashes and can no longer check
       the domain: the match must happen here. */
    const account = await addDeviceAccount()

    await expect(manager.signTypedData(account.id, TYPED_DATA, toChainId(137n))).rejects.toThrow()
  })
})

describe('Protection against a foreign device', () => {
  it('the address is checked before every signature', async () => {
    const account = await addDeviceAccount()

    await manager.signTransaction(account.id, TRANSACTION)

    expect(device.addressReads).toBeGreaterThan(0)
  })

  it('a connected foreign device is not allowed to sign', async () => {
    /* Another seed phrase has another key at the same path. If we
       signed blind, funds would leave an address the person did
       not see on screen, and the shown one would stay untouched. */
    const account = await addDeviceAccount()

    device.key = OTHER_KEY

    await expect(manager.signTransaction(account.id, TRANSACTION)).rejects.toThrow(
      /different address/i,
    )
  })

  it('the signature is rejected before the device is asked for it', async () => {
    /* The refusal must come before the person starts pressing
       buttons: otherwise they will confirm an operation that will
       not happen anyway. */
    const account = await addDeviceAccount(OTHER_ADDRESS)

    await expect(manager.signMessage(account.id, 'anything')).rejects.toThrow(/different address/i)
  })
})

describe('Build without device support', () => {
  it('signing is refused clearly, not by a crash', async () => {
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

describe('Bytes that go to the device', () => {
  it('the same transaction that was shown goes to be signed', async () => {
    /* The manager does not recompute fields: what was shown and
       what was signed must match. */
    const account = await addDeviceAccount()
    const signed = await manager.signTransaction(account.id, TRANSACTION)
    const parsed = Transaction.from(signed.raw)

    expect(parsed.to).toBe(RECIPIENT)
    expect(parsed.value).toBe(TRANSACTION.value)
    expect(parsed.nonce).toBe(TRANSACTION.nonce)
    expect(getBytes(parsed.data)).toHaveLength(0)
  })
})
