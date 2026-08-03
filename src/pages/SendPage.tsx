import {
  ArrowLeft,
  CheckCircle2,
  ExternalLink,
  FileCode,
  Flame,
  ShieldAlert,
  Send,
} from 'lucide-react'
import { useEffect, useId, useState, type FormEvent } from 'react'
import { Link } from 'react-router'

import {
  FEE_PRIORITY,
  RECIPIENT_RISK,
  TRANSACTION_TYPE,
  decodeTransfer,
  findRecipientRisks,
  toWei,
  type Address,
  type FeePriority,
  type IToken,
  type RecipientRisk,
  type TxHash,
} from '@/core'
import { ConfirmPassword, useSecurity } from '@/features/security'
import {
  RECIPIENT_STATUS,
  AccountAvatar,
  addressLabel,
  formatTokenAmount,
  parseAmount,
  useWallet,
  useWalletSnapshot,
  type IPreparedTransfer,
  type IRecipientResolution,
} from '@/features/wallet'
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Input,
  Label,
} from '@/shared/ui'

/** Этапы отправки. */
const STEP = {
  Form: 'form',
  Confirm: 'confirm',
  Result: 'result',
} as const

type Step = (typeof STEP)[keyof typeof STEP]

/**
 * Задержка перед обращением к узлу при вводе получателя.
 *
 * Разрешение имени — сетевой запрос. Без задержки кошелёк спрашивал бы
 * узел на каждую букву: `v`, `vi`, `vit`… — десяток обращений за одно
 * имя и подробный след у оператора узла.
 */
const RESOLVE_DEBOUNCE_MS = 350

/**
 * Значение пункта «нативная валюта» в списке активов.
 *
 * У нативной валюты нет адреса контракта, а `<option>` обязан иметь
 * значение-строку. Пустая строка не годится: браузер считает её
 * отсутствием выбора.
 */
const NATIVE_ASSET_VALUE = 'native'

/** Совпадают ли активы. `null` с обеих сторон — нативная валюта. */
function sameAsset(left: Address | null, right: Address | null): boolean {
  if (left === null || right === null) {
    return left === right
  }

  return left.toLowerCase() === right.toLowerCase()
}

/** Разбор получателя вместе с вводом, которому он соответствует. */
interface IResolvedRecipient {
  /** Строка, для которой получен разбор. */
  readonly input: string
  readonly result: IRecipientResolution
}

const EMPTY_RECIPIENT: IResolvedRecipient = {
  input: '',
  result: { status: RECIPIENT_STATUS.Empty, address: null, name: null, isAscii: true },
}

/**
 * Отправка нативной валюты.
 *
 * ГЛАВНОЕ СВОЙСТВО ЭКРАНА: показанное совпадает с подписываемым.
 * `prepareTransfer` возвращает готовую к подписи транзакцию, экран
 * подтверждения показывает поля именно этого объекта, и он же уходит
 * в подпись без промежуточных пересчётов. Расхождение показанного
 * с подписанным — основной класс атак на интерфейс кошелька.
 *
 * СЕТЬ И АККАУНТ ВЫБИРАЮТСЯ ДО ПОДГОТОВКИ. Переключение любого из них
 * сбрасывает подготовленную транзакцию: она содержит chainId, nonce
 * и адрес отправителя, и после смены перестала бы соответствовать тому,
 * что видит пользователь.
 *
 * ТОКЕН ОТПРАВЛЯЕТСЯ ИНАЧЕ, И ЭКРАН ЭТОГО НЕ СКРЫВАЕТ. При переводе
 * ERC-20 поле `to` подписываемой транзакции указывает на контракт,
 * сумма нативной валюты равна нулю, а настоящий получатель и количество
 * лежат в данных вызова. Экран подтверждения показывает и то, и другое:
 * человек, сверяющий адрес получателя с полем `to`, обязан понимать,
 * почему они не совпадают, — иначе он решит, что кошелёк подменил адрес.
 *
 * РАСШИФРОВКА ДАННЫХ ВЫЗОВА ЧИТАЕТСЯ ИЗ САМОЙ ТРАНЗАКЦИИ, а не берётся
 * из полей формы. Совпадение показанного с подписываемым тогда следует
 * из устройства экрана, а не из аккуратности того, кто его писал.
 */
export function SendPage() {
  const session = useWallet()
  const snapshot = useWalletSnapshot()
  const fieldId = useId()

  const [step, setStep] = useState<Step>(STEP.Form)
  const [recipient, setRecipient] = useState('')
  const [resolved, setResolved] = useState<IResolvedRecipient>(EMPTY_RECIPIENT)
  const [amount, setAmount] = useState('')

  /* Что отправляется. `null` — нативная валюта сети; иначе адрес
     контракта токена. Хранится адрес, а не сам токен: список приходит
     из снимка и пересоздаётся при каждом обновлении баланса, и ссылка
     на прежний объект перестала бы совпадать. */
  const [assetAddress, setAssetAddress] = useState<Address | null>(null)
  const [priority, setPriority] = useState<FeePriority>(FEE_PRIORITY.Medium)
  const [prepared, setPrepared] = useState<IPreparedTransfer | null>(null)
  const [risks, setRisks] = useState<readonly RecipientRisk[]>([])
  const [hash, setHash] = useState<TxHash | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isBusy, setBusy] = useState(false)

  const network = snapshot.activeNetwork
  const account = snapshot.activeAccount

  /* Отслеживаемые активы: первой идёт нативная валюта, дальше токены.
     Список тот же, что на главном экране, — второй источник правды
     о составе кошелька разошёлся бы с первым. */
  const assets = snapshot.tokenBalances
  const selected = assets.find((item) => sameAsset(item.token.address, assetAddress)) ?? null
  const token = selected === null || selected.token.address === null ? null : selected.token

  const decimals = selected?.token.decimals ?? network?.nativeCurrency.decimals ?? 18
  const symbol = selected?.token.symbol ?? network?.nativeCurrency.symbol ?? ''

  /* Доступное количество берётся у выбранного актива. `null` означает
     «прочитать не удалось» и показывается прочерком: ноль на этом месте
     сказал бы, что средств нет. */
  const available = selected === null ? (snapshot.balance?.raw ?? null) : selected.balance

  const trimmedRecipient = recipient.trim()

  /* Признак «идёт разбор» выводится из данных, а не хранится отдельным
     состоянием: два источника истины разошлись бы при отменённом
     запросе, и кнопка осталась бы заблокированной навсегда. */
  const isResolving = trimmedRecipient !== resolved.input
  const recipientAddress = isResolving ? null : resolved.result.address
  const recipientName = isResolving ? null : resolved.result.name

  /**
   * Разбирает введённого получателя с задержкой.
   *
   * Устаревший ответ отбрасывается: пользователь дописал имя, пока
   * шёл запрос по предыдущему, и показать ответ на старую строку
   * значило бы показать чужой адрес рядом с новым именем.
   */
  useEffect(() => {
    const value = recipient.trim()
    let isCurrent = true

    const timer = globalThis.setTimeout(() => {
      void session.resolveRecipient(value).then((result) => {
        if (isCurrent) {
          setResolved({ input: value, result })
        }
      })
    }, RESOLVE_DEBOUNCE_MS)

    return () => {
      isCurrent = false
      globalThis.clearTimeout(timer)
    }
  }, [recipient, session])

  /** Возвращает форму в исходное состояние, сохраняя введённое. */
  function backToForm(): void {
    setStep(STEP.Form)
    setPrepared(null)
    setError(null)
  }

  async function prepare(event: FormEvent): Promise<void> {
    event.preventDefault()

    if (account === null || network === null || recipientAddress === null) {
      return
    }

    setBusy(true)
    setError(null)

    try {
      const value = parseAmount(amount, decimals)

      /* Два разных намерения — два разных вызова. У перевода токена
         получатель и сумма уходят в данные вызова, и собирать их
         в интерфейсе нельзя: ошибка кодирования отправит средства
         не туда без возможности возврата. */
      const result =
        token === null
          ? await session.prepareTransfer({
              chainId: network.chainId,
              from: account.address,
              to: recipientAddress,
              /* `toWei` — единственный допустимый способ получить
                 брендированное значение: приведение типом обошло бы
                 проверку диапазона. */
              value: toWei(value),
            })
          : await session.prepareTokenTransfer({
              chainId: network.chainId,
              from: account.address,
              token: token.address as Address,
              to: recipientAddress,
              amount: value,
            })

      /* Замечания считаются по ВВЕДЁННОЙ строке, а не по полю готовой
         транзакции: `toAddress` приводит адрес к записи с контрольной
         суммой, и признак «введено без неё» после нормализации теряется.
         Исключение — адрес, полученный из имени: его пользователь
         не набирал, и упрекать его в отсутствии контрольной суммы
         не за что. */
      const found = [
        ...findRecipientRisks(
          resolved.result.status === RECIPIENT_STATUS.Address ? trimmedRecipient : recipientAddress,
          account.address,
        ),
      ]

      /* Признак контракта требует обращения к узлу, поэтому проверяется
         здесь, один раз, а не в чистой функции выше. Отказ узла даёт
         `null` и не добавляет замечания: «проверить не удалось» нельзя
         показывать как «получатель обычный адрес». */
      const isContract = await session.isContractRecipient(recipientAddress)

      if (isContract === true) {
        /* Для токена «получатель — контракт» звучит иначе: перевод
           токена контракту, который его не ждёт, теряется так же
           безвозвратно, но нативная валюта здесь ни при чём. */
        found.push(RECIPIENT_RISK.ContractRecipient)
      }

      setRisks(found)
      setPrepared(applyPriority(result, priority))
      setStep(STEP.Confirm)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setBusy(false)
    }
  }

  async function confirm(): Promise<void> {
    if (prepared === null) {
      return
    }

    setBusy(true)
    setError(null)

    try {
      setHash(await session.sendTransfer(prepared.transaction))
      setStep(STEP.Result)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setBusy(false)
    }
  }

  if (step === STEP.Result && hash !== null) {
    return <SendResult hash={hash} explorer={network?.blockExplorerUrls[0] ?? null} />
  }

  if (step === STEP.Confirm && prepared !== null) {
    return (
      <ConfirmTransfer
        prepared={prepared}
        token={token}
        risks={risks}
        recipientName={recipientName}
        symbol={symbol}
        decimals={decimals}
        networkName={network?.name ?? ''}
        error={error}
        isBusy={isBusy}
        onBack={backToForm}
        onConfirm={() => void confirm()}
      />
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <header className="flex items-center gap-2">
        <Button asChild variant="ghost" size="icon" aria-label="Назад">
          <Link to="/wallet">
            <ArrowLeft className="size-4" aria-hidden />
          </Link>
        </Button>
        <h1 className="text-lg font-semibold">Отправка</h1>
      </header>

      <Card>
        <CardHeader>
          <CardTitle className="text-base font-medium text-muted-foreground">Откуда</CardTitle>
        </CardHeader>

        <CardContent className="flex flex-col gap-3">
          {account === null ? null : (
            <div className="flex items-center gap-3 rounded-xl border p-3">
              <AccountAvatar address={account.address} />

              <div className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-sm font-medium">{account.name}</span>
                <span className="truncate text-xs text-muted-foreground">
                  {addressLabel(account.address, snapshot.ensNames)}
                </span>
              </div>

              {network === null ? null : (
                <Badge variant={network.isTestnet ? 'warning' : 'default'}>{network.name}</Badge>
              )}
            </div>
          )}

          {/* Выбор сети и аккаунта живёт в настройках: дублировать его здесь
              значило бы дать два места смены одного и того же состояния
              и получить расхождение между ними. */}
          <p className="text-xs text-muted-foreground">
            Сеть и аккаунт меняются в настройках. Перевод уйдёт из сети {network?.name ?? '—'} с
            показанного адреса.
          </p>

          <div className="flex items-baseline justify-between text-xs">
            <span className="text-muted-foreground">Доступно</span>
            <span className="tabular-nums">
              {available === null ? '—' : `${formatTokenAmount(available, decimals)} ${symbol}`}
            </span>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent>
          <form
            className="flex flex-col gap-4"
            onSubmit={(event) => {
              void prepare(event)
            }}
          >
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`${fieldId}-to`}>Адрес получателя или имя ENS</Label>
              <Input
                id={`${fieldId}-to`}
                value={recipient}
                placeholder="0x… или имя.eth"
                autoComplete="off"
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
                onChange={(event) => {
                  setRecipient(event.target.value)
                  setError(null)
                }}
              />

              <RecipientHint
                isResolving={isResolving && trimmedRecipient !== ''}
                resolution={resolved.result}
                isEnsSupported={snapshot.isEnsSupported}
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`${fieldId}-asset`}>Что отправить</Label>
              <select
                id={`${fieldId}-asset`}
                value={assetAddress ?? NATIVE_ASSET_VALUE}
                className="h-9 w-full rounded-md border bg-transparent px-3 py-1 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
                onChange={(event) => {
                  /* Сумма сбрасывается вместе с активом: число знаков
                     у токенов разное, и «10», набранное для актива
                     с восемнадцатью знаками, при шести означало бы
                     совсем другую величину. */
                  setAssetAddress(
                    event.target.value === NATIVE_ASSET_VALUE
                      ? null
                      : (event.target.value as Address),
                  )
                  setAmount('')
                  setError(null)
                }}
              >
                {assets.map((item) => (
                  <option
                    key={item.token.address ?? NATIVE_ASSET_VALUE}
                    value={item.token.address ?? NATIVE_ASSET_VALUE}
                  >
                    {item.token.symbol}
                    {item.token.isCustom ? ' — добавлен вручную' : ''}
                  </option>
                ))}
              </select>

              {token === null ? null : (
                /* Символ токена задаёт автор контракта, и выпустить токен
                   с чужим символом может кто угодно. Адрес контракта —
                   единственное, что отличает настоящий USDC от поддельного. */
                <p className="text-xs break-all text-muted-foreground">
                  Контракт: <span className="font-mono">{token.address}</span>
                </p>
              )}
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`${fieldId}-amount`}>Сумма, {symbol}</Label>
              <Input
                id={`${fieldId}-amount`}
                value={amount}
                placeholder="0.0"
                inputMode="decimal"
                autoComplete="off"
                onChange={(event) => {
                  setAmount(event.target.value)
                  setError(null)
                }}
              />
            </div>

            <fieldset className="flex flex-col gap-2">
              <legend className="mb-1 text-sm font-medium">Скорость</legend>
              <div className="grid grid-cols-3 gap-2">
                {FEE_LEVELS.map((level) => (
                  <button
                    key={level.value}
                    type="button"
                    aria-pressed={priority === level.value}
                    onClick={() => {
                      setPriority(level.value)
                    }}
                    className={
                      priority === level.value
                        ? 'rounded-xl border border-primary bg-primary/10 px-2 py-2 text-xs font-medium text-primary-emphasis'
                        : 'rounded-xl border px-2 py-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent'
                    }
                  >
                    {level.label}
                  </button>
                ))}
              </div>
            </fieldset>

            {error === null ? null : (
              <Alert variant="danger">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            <Button
              type="submit"
              size="lg"
              disabled={
                isBusy || account === null || recipientAddress === null || amount.trim() === ''
              }
            >
              <Send className="size-4" aria-hidden />
              {isBusy ? 'Оценка комиссии…' : 'Далее'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}

interface RecipientHintProps {
  readonly isResolving: boolean
  readonly resolution: IRecipientResolution
  readonly isEnsSupported: boolean
}

/**
 * Подсказка под полем получателя.
 *
 * ГЛАВНОЕ ЗДЕСЬ — РАЗНЫЕ ТЕКСТЫ ДЛЯ РАЗНЫХ ПРИЧИН. «Имени не существует»
 * и «узел не ответил» выглядят на экране одинаково безобидно, но требуют
 * противоположных действий: в первом случае имя набрано неверно,
 * во втором оно, возможно, верно, а проверить нечем. Одно сообщение
 * на оба случая отправило бы человека вводить адрес по памяти.
 *
 * РАЗРЕШЁННОЕ ИМЯ ПОКАЗЫВАЕТСЯ ВМЕСТЕ С ПОЛНЫМ АДРЕСОМ. Имя удобно,
 * но подписывается адрес, и увидеть его пользователь обязан до того,
 * как нажмёт «Далее».
 */
function RecipientHint({ isResolving, resolution, isEnsSupported }: RecipientHintProps) {
  if (isResolving) {
    return <p className="text-xs text-muted-foreground">Проверка…</p>
  }

  switch (resolution.status) {
    case RECIPIENT_STATUS.Empty:
      return null

    case RECIPIENT_STATUS.Address:
      return resolution.name === null ? null : (
        <p className="text-xs text-muted-foreground">
          Имя этого адреса: <span className="font-medium text-foreground">{resolution.name}</span>.
          Имя подтверждено прямым разрешением.
        </p>
      )

    case RECIPIENT_STATUS.NameResolved:
      return (
        <p className="flex flex-col gap-0.5 text-xs text-muted-foreground">
          <span>Имя разрешено в адрес:</span>
          <span className="font-mono break-all text-foreground">{resolution.address}</span>
          {/* ENSIP-15 запрещает смешивать письменности внутри метки,
              но имя, целиком записанное другой письменностью, остаётся
              законным — и может выглядеть как латинское. Запретить его
              нельзя, промолчать о нём тоже. */}
          {resolution.isAscii ? null : (
            <span>
              Имя записано не латиницей. Похожие по виду имена принадлежат разным людям — сверьте
              адрес с тем, который вам назвали.
            </span>
          )}
        </p>
      )

    case RECIPIENT_STATUS.NameNotFound:
      return (
        <p className="text-xs text-destructive">
          Записи для этого имени нет. Проверьте написание — средства уйдут только на адрес.
        </p>
      )

    case RECIPIENT_STATUS.NameUnsupported:
      return (
        <p className="text-xs text-destructive">
          Имя не проходит проверку ENS: в одной части имени смешаны разные письменности либо
          использован запрещённый символ. Так подделывают имена под чужие — вводите адрес.
        </p>
      )

    case RECIPIENT_STATUS.EnsUnavailable:
      return (
        <p className="text-xs text-muted-foreground">
          {isEnsSupported
            ? 'Имена ENS сейчас недоступны.'
            : 'Реестр ENS существует только в сети Ethereum. В текущей сети имя разрешить нечем — введите адрес.'}
        </p>
      )

    case RECIPIENT_STATUS.Failed:
      return (
        <p className="text-xs text-destructive">
          Проверить имя не удалось: узел не ответил. Это не значит, что имени не существует.
        </p>
      )

    case RECIPIENT_STATUS.Invalid:
      return (
        <p className="text-xs text-muted-foreground">
          Введите адрес из 42 символов, начинающийся с 0x, либо имя ENS вида имя.eth.
        </p>
      )
  }
}

/** Уровни срочности в порядке возрастания. */
const FEE_LEVELS: readonly { value: FeePriority; label: string }[] = [
  { value: FEE_PRIORITY.Low, label: 'Обычная' },
  { value: FEE_PRIORITY.Medium, label: 'Быстрая' },
  { value: FEE_PRIORITY.High, label: 'Срочная' },
]

/**
 * Применяет выбранный уровень комиссии к подготовленной транзакции.
 *
 * Пересчёт выполняется ОДИН РАЗ, до показа подтверждения. После этого
 * объект не меняется: экран показывает те же поля, что уходят в подпись.
 */
function applyPriority(prepared: IPreparedTransfer, priority: FeePriority): IPreparedTransfer {
  const fee = prepared.fees.find((item) => item.priority === priority)

  if (fee === undefined) {
    return prepared
  }

  return {
    ...prepared,
    transaction: {
      ...prepared.transaction,
      gasLimit: fee.gasLimit,
      maxFeePerGas: fee.maxFeePerGas,
      maxPriorityFeePerGas: fee.maxPriorityFeePerGas,
      gasPrice: fee.gasPrice,
    },
  }
}

interface ConfirmTransferProps {
  readonly prepared: IPreparedTransfer

  /**
   * Отправляемый токен. `null` — нативная валюта сети.
   *
   * Нужен для подписей и числа знаков; получатель и сумма берутся
   * не отсюда, а из данных подписываемой транзакции.
   */
  readonly token: IToken | null

  readonly risks: readonly RecipientRisk[]

  /**
   * Имя ENS получателя, если оно известно.
   *
   * Показывается ДОПОЛНИТЕЛЬНО к адресу и никогда вместо него.
   */
  readonly recipientName: string | null

  readonly symbol: string
  readonly decimals: number
  readonly networkName: string
  readonly error: string | null
  readonly isBusy: boolean
  readonly onBack: () => void
  readonly onConfirm: () => void
}

/**
 * Подтверждение перевода.
 *
 * ПОКАЗЫВАЮТСЯ ПОЛЯ ПОДПИСЫВАЕМОГО ОБЪЕКТА, а не пересчитанные заново
 * значения. Пользователь видит адрес получателя целиком: усечённый
 * невозможно сверить посимвольно, а именно посимвольная сверка защищает
 * от подмены содержимого буфера обмена.
 */
function ConfirmTransfer({
  prepared,
  token,
  risks,
  recipientName,
  symbol,
  decimals,
  networkName,
  error,
  isBusy,
  onBack,
  onConfirm,
}: ConfirmTransferProps) {
  const { settings, verifyPassword } = useSecurity()
  const [isConfirming, setConfirming] = useState(false)

  const { transaction } = prepared
  const feePerGas = transaction.maxFeePerGas ?? transaction.gasPrice ?? 0n
  const maxFee = transaction.gasLimit * feePerGas

  /* РАСШИФРОВКА ЧИТАЕТСЯ ИЗ ПОДПИСЫВАЕМОГО ОБЪЕКТА, а не из полей формы.
     Показать получателя, взятого из состояния экрана, значило бы
     утверждать, что в данных вызова записан именно он, — а проверено
     это не было бы ничем. */
  const call = token === null ? null : decodeTransfer(transaction.data)

  /* Настоящий получатель: у токена он в данных вызова, у нативной
     валюты — в поле `to`. */
  const recipient = call?.to ?? transaction.to
  const amount = call === null ? transaction.value : call.amount

  return (
    <div className="flex flex-col gap-4">
      <header className="flex items-center gap-2">
        <Button variant="ghost" size="icon" aria-label="Назад" onClick={onBack}>
          <ArrowLeft className="size-4" aria-hidden />
        </Button>
        <h1 className="text-lg font-semibold">Подтверждение</h1>
      </header>

      <Card>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-col items-center gap-1 py-2 text-center">
            <span className="text-3xl font-semibold tabular-nums">
              {formatTokenAmount(amount, decimals)} {symbol}
            </span>
            <span className="text-xs text-muted-foreground">{networkName}</span>
            {token === null ? null : (
              <span className="text-xs text-muted-foreground">
                Токен {token.name}
                {token.isCustom ? ', добавлен вручную' : ''}
              </span>
            )}
          </div>

          <div className="flex flex-col gap-1.5">
            <span className="text-xs text-muted-foreground">Получатель</span>

            {/* Имя выводится НАД адресом и не заменяет его. Подписывается
                адрес: показать вместо него имя значило бы показать не то,
                что подписывается, — основной класс атак на интерфейс
                кошелька. */}
            {recipientName === null ? null : (
              <span className="text-sm font-medium">{recipientName}</span>
            )}

            <span className="font-mono text-sm break-all">{recipient ?? '—'}</span>

            {recipientName === null ? null : (
              <span className="text-xs text-muted-foreground">
                Адрес получен из имени ENS. Сверьте его с тем, который вам назвали: имя может
                указывать на другой адрес, чем вчера.
              </span>
            )}
          </div>

          {token === null ? null : (
            /* ЧЕЛОВЕК, СВЕРЯЮЩИЙ АДРЕСА, ОБЯЗАН ПОНИМАТЬ, ПОЧЕМУ ИХ ДВА.
               В сети транзакция уйдёт контракту токена, а не получателю;
               умолчать об этом значит показать одно, а подписать другое. */
            <div className="flex flex-col gap-1.5 rounded-xl border p-3">
              <span className="text-xs text-muted-foreground">
                Транзакция будет отправлена контракту токена
              </span>
              <span className="font-mono text-sm break-all">{transaction.to ?? '—'}</span>
              <span className="text-xs text-muted-foreground">
                Так работает перевод токена: контракт переписывает {symbol} на адрес получателя.
                Самой валюты {'«'}
                {networkName}
                {'»'} при этом переводится ноль — списывается только комиссия.
              </span>
            </div>
          )}

          <div className="flex flex-col gap-1.5">
            <span className="text-xs text-muted-foreground">Отправитель</span>
            <span className="font-mono text-sm break-all">{transaction.from}</span>
          </div>

          <dl className="flex flex-col gap-2 border-t pt-3 text-sm">
            <Row label="Максимальная комиссия">
              {formatTokenAmount(maxFee, decimals)} {symbol}
            </Row>
            <Row label="Лимит газа">{transaction.gasLimit.toString()}</Row>
            <Row label="Номер (nonce)">{String(transaction.nonce)}</Row>
            <Row label="Тип">
              {transaction.type === TRANSACTION_TYPE.Eip1559 ? 'EIP-1559' : 'Legacy'}
            </Row>
            <Row label="chainId">{transaction.chainId.toString()}</Row>
          </dl>

          <p className="text-xs text-muted-foreground">
            Списано будет не больше указанной комиссии; неизрасходованный газ вернётся.
          </p>
        </CardContent>
      </Card>

      {risks.map((risk) => (
        <RiskAlert key={risk} risk={risk} />
      ))}

      {error === null ? null : (
        <Alert variant="danger">
          <AlertTitle>Отправить не удалось</AlertTitle>
          <AlertDescription>
            {error} Если узел не ответил, судьба перевода неизвестна: возможно, он принят. Проверьте
            историю и обозреватель прежде, чем отправлять повторно.
          </AlertDescription>
        </Alert>
      )}

      <Alert variant="warning">
        <AlertDescription>
          Перевод в блокчейне необратим. Отменить его после отправки невозможно ни кошельком, ни
          поддержкой.
        </AlertDescription>
      </Alert>

      {/* Повторный ввод пароля защищает от того, кто получил доступ
          к уже разблокированному кошельку. Настройка включена
          по умолчанию: цена ошибки здесь — все средства. */}
      {isConfirming ? (
        <ConfirmPassword
          action="отправку перевода"
          onVerify={verifyPassword}
          onConfirmed={() => {
            setConfirming(false)
            onConfirm()
          }}
          onCancel={() => {
            setConfirming(false)
          }}
        />
      ) : (
        <Button
          size="lg"
          variant="destructive"
          disabled={isBusy}
          onClick={() => {
            if (settings.confirmBeforeSigning) {
              setConfirming(true)

              return
            }

            onConfirm()
          }}
        >
          {isBusy ? 'Отправка…' : 'Подтвердить и отправить'}
        </Button>
      )}
    </div>
  )
}

function Row({ label, children }: { readonly label: string; readonly children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-right font-mono text-xs tabular-nums">{children}</dd>
    </div>
  )
}

function RiskAlert({ risk }: { readonly risk: string }) {
  if (risk === RECIPIENT_RISK.BurnAddress) {
    return (
      <Alert variant="danger">
        <Flame />
        <AlertTitle>Адрес сжигания</AlertTitle>
        <AlertDescription>
          Средства, отправленные на этот адрес, исчезнут безвозвратно: получить их не сможет никто.
        </AlertDescription>
      </Alert>
    )
  }

  if (risk === RECIPIENT_RISK.SelfTransfer) {
    return (
      <Alert variant="warning">
        <AlertDescription>
          Получатель совпадает с отправителем. Перевод состоится, но средства останутся на том же
          адресе, а комиссия будет списана.
        </AlertDescription>
      </Alert>
    )
  }

  if (risk === RECIPIENT_RISK.ContractRecipient) {
    return (
      <Alert variant="danger">
        <FileCode />
        <AlertTitle>Получатель — контракт</AlertTitle>
        <AlertDescription>
          По этому адресу размещён код, а не обычный кошелёк. Монеты, отправленные контракту,
          который их не принимает, теряются безвозвратно: вернуть их может только код самого
          контракта, а его может не оказаться. Самый частый случай — перевод монет на адрес
          токен-контракта.
        </AlertDescription>
      </Alert>
    )
  }

  return (
    <Alert variant="warning">
      <ShieldAlert />
      <AlertDescription>
        Адрес записан без контрольной суммы: опечатка в нём не обнаруживается. Сверьте адрес
        посимвольно — перевод на ошибочный адрес необратим.
      </AlertDescription>
    </Alert>
  )
}

/** Итог отправки: хэш и путь к обозревателю. */
function SendResult({
  hash,
  explorer,
}: {
  readonly hash: TxHash
  readonly explorer: string | null
}) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col items-center gap-3 py-6 text-center">
        <span className="icon-tile size-14 rounded-2xl">
          <CheckCircle2 className="size-7" aria-hidden />
        </span>

        <div className="flex flex-col gap-1">
          <h1 className="text-lg font-semibold">Транзакция отправлена</h1>
          <p className="text-sm text-muted-foreground">
            Она принята узлом и ожидает включения в блок.
          </p>
        </div>
      </div>

      <Card>
        <CardContent className="flex flex-col gap-2">
          <span className="text-xs text-muted-foreground">Хэш транзакции</span>
          <span className="font-mono text-sm break-all">{hash}</span>

          {explorer === null ? null : (
            <Button asChild variant="outline" size="sm" className="mt-2">
              <a href={`${explorer}/tx/${hash}`} target="_blank" rel="noreferrer noopener">
                <ExternalLink className="size-4" aria-hidden />
                Открыть в обозревателе
              </a>
            </Button>
          )}
        </CardContent>
      </Card>

      <Alert>
        <AlertDescription>
          Принятие узлом не означает включения в блок. Состояние обновится в разделе «История».
        </AlertDescription>
      </Alert>

      <Button asChild size="lg">
        <Link to="/wallet">Вернуться в кошелёк</Link>
      </Button>
    </div>
  )
}
