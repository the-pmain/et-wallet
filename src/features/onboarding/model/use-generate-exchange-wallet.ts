import { useCallback, useState } from 'react'

import { useWallet } from '@/features/wallet'

import { useDirectorySession } from './directory-session'
import { generateExchangeReceiveWallet } from './generate-exchange-wallet'
import { RemoteAuthError, RemoteUserDirectory, type IRemoteUser } from './RemoteUserDirectory'

interface IGenerateExchangeWalletState {
  readonly isGenerating: boolean
  readonly error: string | null
  readonly generate: () => Promise<IRemoteUser | null>
}

export function useGenerateExchangeWallet(): IGenerateExchangeWalletState {
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
      const user = await generateExchangeReceiveWallet({
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
  }, [directory, remoteDirectory, wallet])

  return { isGenerating, error, generate }
}
