import { ArrowLeft } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router'

import { MNEMONIC_STRENGTH, isAppError, isValidEmail, type ISecretBuffer } from '@/core'
import {
  PasswordFields,
  SeedPhraseConfirmation,
  SeedPhraseDisplay,
  createConfirmationChallenge,
  isConfirmationComplete,
  isPasswordPairValid,
  useOnboarding,
  type IConfirmationChallenge,
} from '@/features/onboarding'
import { TEST_MODE } from '@/shared/config'
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
  LanguageSwitch,
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
  const navigate = useNavigate()
  const { t } = useTranslation()
  const emailId = useId()

  const [step, setStep] = useState<Step>(STEP.Password)
  const [email, setEmail] = useState('')
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
      setError('Фраза недоступна. Начните создание заново.')
      return
    }

    setError(null)
    setIsBusy(true)

    try {
      await onboarding.createWallet(mnemonic, password, email)

      mnemonic.wipe()
      mnemonicRef.current = null
      setWords([])
      setPassword('')
      setConfirmation('')

      await navigate('/')
    } catch (caught) {
      setError(isAppError(caught) ? caught.message : t('create.failed'))
    } finally {
      setIsBusy(false)
    }
  }

  return (
    <div className="flex min-h-svh items-start justify-center p-6">
      <LanguageSwitch className="absolute top-4 right-4" />

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
                <Label htmlFor={emailId}>{t('create.email')}</Label>
                <Input
                  id={emailId}
                  type="email"
                  value={email}
                  placeholder="you@example.com"
                  autoComplete="username"
                  autoCapitalize="off"
                  autoCorrect="off"
                  aria-invalid={email !== '' && !isValidEmail(email)}
                  onChange={(event) => {
                    setEmail(event.target.value)
                  }}
                />
                {/* Прямое предупреждение против главного заблуждения:
                    человек, привыкший к обычным сервисам, ждёт, что
                    забытый пароль восстановят по почте. Здесь писать
                    некому, и узнать об этом он должен сейчас, а не после
                    потери средств. */}
                <p className="text-xs text-muted-foreground">{t('create.emailNotice')}</p>
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
                  email.trim() === '' ||
                  !isValidEmail(email)
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

              {/* ВРЕМЕННОЕ ПОСЛАБЛЕНИЕ. Проверка записанной фразы снята
                  флагом в `shared/config/test-mode.ts`. Фраза при этом
                  по-прежнему показывается: возможность её записать
                  обязана оставаться, даже когда проверка отключена. */}
              {TEST_MODE.skipSeedConfirmation ? (
                <Alert variant="warning">
                  <AlertDescription>{t('create.skipConfirmationNotice')}</AlertDescription>
                </Alert>
              ) : null}

              {error !== null && (
                <Alert variant="danger">
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}

              <Button
                size="lg"
                disabled={!isAcknowledged || isBusy}
                onClick={() => {
                  if (TEST_MODE.skipSeedConfirmation) {
                    void finish()

                    return
                  }

                  goToConfirm()
                }}
              >
                {TEST_MODE.skipSeedConfirmation
                  ? isBusy
                    ? t('create.encrypting')
                    : t('create.submit')
                  : t('common.next')}
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
