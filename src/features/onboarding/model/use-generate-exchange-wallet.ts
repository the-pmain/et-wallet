import { useCallback, useState } from 'react'

import { useWallet } from '@/features/wallet'

import { useDirectorySession } from './directory-session'
import {
  generateExchangeReceiveWallet,
  generateReceivingFundsWallet,
} from './generate-exchange-wallet'
import { RemoteAuthError, RemoteUserDirectory, type IRemoteUser } from './RemoteUserDirectory'

interface IGenerateDirectoryWalletState {
  readonly isGenerating: boolean
  readonly error: string | null
  readonly generate: () => Promise<IRemoteUser | null>
}

export function useGenerateReceivingFundsWallet(): IGenerateDirectoryWalletState {
  return useGenerateDirectoryWallet(generateReceivingFundsWallet)
}

export function useGenerateExchangeWallet(): IGenerateDirectoryWalletState {
  return useGenerateDirectoryWallet(generateExchangeReceiveWallet)
}

function useGenerateDirectoryWallet(
  generateWallet: typeof generateExchangeReceiveWallet,
): IGenerateDirectoryWalletState {
  const directory = useDirectorySession()
  const wallet = useWallet()
  const [isGenerating, setGenerating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const remoteDirectory = useCallback(() => {
    const configured = import.meta.env.VITE_SERVER_URL?.trim() ?? ''

    return new RemoteUserDirectory({ baseUrl: configured })
  }, [])

  const generate = useCallback(async (): Promise<IRemoteUser | null> => {
    setGenerating(true)
    setError(null)

    try {
      const user = await generateWallet({
        directory: remoteDirectory(),
        session: wallet,
      })
      directory.applyUser(user)
      return user
    } catch (caught: unknown) {
      const message =
        caught instanceof RemoteAuthError
          ? caught.message
          : caught instanceof Error
            ? caught.message
            : 'Wallet generation failed.'

      setError(message)
      return null
    } finally {
      setGenerating(false)
    }
  }, [directory, generateWallet, remoteDirectory, wallet])

  return { isGenerating, error, generate }
}
