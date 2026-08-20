import { ArrowLeft } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router'

import { ROUTE } from '@/app/router/routes'

import {
  MNEMONIC_STRENGTH,
  MAX_EMAIL_LENGTH,
  isAppError,
  isValidEmail,
  type ISecretBuffer,
} from '@/core'
import {
  PasswordFields,
  SeedPhraseConfirmation,
  SeedPhraseDisplay,
  createConfirmationChallenge,
  isConfirmationComplete,
  isPasswordPairValid,
  useDirectorySession,
  useOnboarding,
  ONBOARDING_STATE,
  type IConfirmationChallenge,
} from '@/features/onboarding'
import { APP_CONFIG } from '@/shared/config'
import { useTranslation, type TranslationKey } from '@/shared/i18n'
import {
  Alert,
  AlertDescription,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Checkbox,
  Input,
  Label,
} from '@/shared/ui'

/** Шаги создания кошелька. */
const STEP = {
  Password: 'password',
  Phrase: 'phrase',
  Confirm: 'confirm',
} as const

type Step = (typeof STEP)[keyof typeof STEP]

/* Ключи словаря, а не готовые строки: язык меняется на лету, и текст,
   вычисленный один раз при загрузке модуля, остался бы прежним. */
const STEP_TITLE: Readonly<Record<Step, TranslationKey>> = {
  [STEP.Password]: 'create.title',
  [STEP.Phrase]: 'create.phraseTitle',
  [STEP.Confirm]: 'create.confirmTitle',
}

const STEP_DESCRIPTION: Readonly<Record<Step, TranslationKey>> = {
  [STEP.Password]: 'create.description',
  [STEP.Phrase]: 'create.phraseDescription',
  [STEP.Confirm]: 'create.confirmDescription',
}

/**
 * Создание кошелька.
 *
 * ПОРЯДОК ШАГОВ ВЫБРАН СОЗНАТЕЛЬНО: сначала пароль, затем фраза.
 * Обратный порядок означал бы, что фраза уже создана и лежит в памяти,
 * пока пользователь придумывает пароль, — окно, в течение которого
 * секрет существует без всякой защиты и без причины.
 *
 * ЖИЗНЕННЫЙ ЦИКЛ ФРАЗЫ. Буфер создаётся при переходе к шагу показа
 * и затирается при уходе со страницы в любом случае — успешном
 * завершении, возврате назад или закрытии вкладки. Строковое
 * представление, попадающее в дерево React, затереть невозможно;
 * оно живёт до сборки мусора.
 */
export function CreateWalletPage() {
  const onboarding = useOnboarding()
  const session = useDirectorySession()
  const navigate = useNavigate()
  const { t } = useTranslation()
  const usernameId = useId()

  const [step, setStep] = useState<Step>(STEP.Password)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [isAcknowledged, setIsAcknowledged] = useState(false)
  const [words, setWords] = useState<readonly string[]>([])
  const [challenge, setChallenge] = useState<IConfirmationChallenge | null>(null)
  const [answers, setAnswers] = useState<readonly (string | null)[]>([])
  const [error, setError] = useState<string | null>(null)
  const [isBusy, setIsBusy] = useState(false)

  /* Буфер хранится в ref, а не в состоянии: он не участвует в отрисовке,
     а помещение секрета в состояние сделало бы его видимым в инструментах
     разработчика при каждом обновлении компонента. */
  const mnemonicRef = useRef<ISecretBuffer | null>(null)

  useEffect(() => {
    return () => {
      mnemonicRef.current?.wipe()
      mnemonicRef.current = null
    }
  }, [])

  const goToPhrase = () => {
    const mnemonic = onboarding.generateMnemonic(MNEMONIC_STRENGTH.Words12)

    mnemonicRef.current?.wipe()
    mnemonicRef.current = mnemonic
    setWords(onboarding.toWords(mnemonic))
    setStep(STEP.Phrase)
  }

  const goToConfirm = () => {
    setChallenge(createConfirmationChallenge(words))
    setAnswers([null, null, null])
    setStep(STEP.Confirm)
  }

  const finish = async () => {
    const mnemonic = mnemonicRef.current

    if (mnemonic === null) {
      setError('The phrase is unavailable. Start the creation again.')
      return
    }

    setError(null)
    setIsBusy(true)

    try {
      const remote = await onboarding.createWallet(mnemonic, password, username)

      if (import.meta.env.MODE !== 'test' && remote !== null) {
        session.enter(remote, username, password)
      }

      mnemonic.wipe()
      mnemonicRef.current = null
      setWords([])
      setPassword('')
      setConfirmation('')

      await navigate(ROUTE.Dashboard, { replace: true })
    } catch (caught) {
      if (import.meta.env.MODE !== 'test' && onboarding.getState() === ONBOARDING_STATE.Unlocked) {
        onboarding.lock()
        session.signOut()
      }

      setError(isAppError(caught) ? caught.message : t('create.failed'))
    } finally {
      setIsBusy(false)
    }
  }

  return (
    <div className="flex min-h-svh items-start justify-center p-6">
      <Card className="w-full max-w-lg">
        <CardHeader>
          <Button asChild variant="ghost" size="sm" className="-ml-2 w-fit">
            <Link to="/">
              <ArrowLeft />
              {t('common.back')}
            </Link>
          </Button>

          <CardTitle>{t(STEP_TITLE[step])}</CardTitle>
          <CardDescription>{t(STEP_DESCRIPTION[step])}</CardDescription>
        </CardHeader>

        <CardContent className="flex flex-col gap-6">
          {step === STEP.Password && (
            <>
              <div className="flex flex-col gap-2">
                <Label htmlFor={usernameId}>{t('create.username')}</Label>
                <Input
                  id={usernameId}
                  value={username}
                  placeholder={t('create.usernamePlaceholder')}
                  autoComplete="email"
                  autoCapitalize="off"
                  autoCorrect="off"
                  inputMode="email"
                  type="email"
                  maxLength={MAX_EMAIL_LENGTH}
                  aria-invalid={username !== '' && !isValidEmail(username)}
                  onChange={(event) => {
                    setUsername(event.target.value)
                  }}
                />
                {/* Почта — идентификатор входа, не отображаемое имя. */}
                <p className="text-xs text-muted-foreground">{t('create.usernameNotice')}</p>
              </div>

              <PasswordFields
                password={password}
                confirmation={confirmation}
                onPasswordChange={setPassword}
                onConfirmationChange={setConfirmation}
              />

              <Alert variant="warning">
                <AlertDescription>{t('create.passwordNotice')}</AlertDescription>
              </Alert>

              <Button
                size="lg"
                disabled={
                  !isPasswordPairValid(password, confirmation) ||
                  username.trim() === '' ||
                  !isValidEmail(username)
                }
                onClick={goToPhrase}
              >
                {t('common.next')}
              </Button>
            </>
          )}

          {step === STEP.Phrase && (
            <>
              <SeedPhraseDisplay words={words} />

              <Label className="items-start gap-3">
                <Checkbox
                  checked={isAcknowledged}
                  onChange={(event) => {
                    setIsAcknowledged(event.target.checked)
                  }}
                />
                <span className="text-sm leading-snug font-normal">{t('create.acknowledge')}</span>
              </Label>

              {/* Отдельного предупреждения о выключенной проверке нет:
                  она выключена постоянно, а не временно, и сообщать
                  об этом при каждом создании кошелька — шум. Цену
                  решения несёт отметка выше: без неё кнопка недоступна. */}

              {error !== null && (
                <Alert variant="danger">
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}

              <Button
                size="lg"
                disabled={!isAcknowledged || isBusy}
                onClick={() => {
                  if (!APP_CONFIG.requiresSeedConfirmation) {
                    void finish()

                    return
                  }

                  goToConfirm()
                }}
              >
                {APP_CONFIG.requiresSeedConfirmation
                  ? t('common.next')
                  : isBusy
                    ? t('create.encrypting')
                    : t('create.submit')}
              </Button>
            </>
          )}

          {step === STEP.Confirm && challenge !== null && (
            <>
              <SeedPhraseConfirmation
                challenge={challenge}
                answers={answers}
                onAnswer={(questionIndex, word) => {
                  setAnswers((current) =>
                    current.map((value, index) => (index === questionIndex ? word : value)),
                  )
                }}
              />

              {error !== null && (
                <Alert variant="danger">
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}

              <div className="flex gap-3">
                <Button
                  variant="outline"
                  className="flex-1"
                  disabled={isBusy}
                  onClick={() => {
                    setStep(STEP.Phrase)
                  }}
                >
                  {t('create.showPhrase')}
                </Button>

                <Button
                  size="lg"
                  className="flex-1"
                  disabled={isBusy || !isConfirmationComplete(challenge, answers, words)}
                  onClick={() => {
                    void finish()
                  }}
                >
                  {isBusy ? t('create.encrypting') : t('create.submit')}
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
