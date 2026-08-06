import { safeText } from '@/core'
import { AlertTriangle, ArrowRight, RefreshCw } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Link } from 'react-router'

import type { IBalance, INetworkConfig, IPortfolioSummary } from '@/core'
import { useTranslation } from '@/shared/i18n'
import { cn } from '@/shared/lib/utils'
import { Button, Card, CardContent, CardHeader, CardTitle } from '@/shared/ui'

import { formatTokenAmount } from '../lib/format'
import { estimateNativeValue } from '../lib/asset-value'
import { formatFiat, formatQuoteTime } from '../lib/portfolio-display'

interface BalanceCardProps {
  readonly balance: IBalance | null
  readonly network: INetworkConfig | null
  readonly isLoading: boolean
  readonly error: string | null
  readonly onRefresh: () => void

  /**
   * Сводка портфеля активной сети. Отсюда берётся только курс нативной
   * валюты: сама оценка считается от показанного баланса.
   */
  readonly portfolio?: IPortfolioSummary | null

  /** Согласие на обращение к стороннему источнику курсов дано. */
  readonly arePricesEnabled?: boolean

  /** Идёт получение курсов. */
  readonly isPortfolioLoading?: boolean

  /**
   * Переход, добавляемый под балансом.
   *
   * Передаётся страницей, а не собирается здесь: адреса экранов живут
   * в слое приложения, а этот слой их не видит. Ссылка, собранная тут
   * строковым литералом, разошлась бы с таблицей маршрутов при первом
   * же переименовании.
   */
  readonly action?: ReactNode
}

/**
 * Баланс нативной валюты активного аккаунта.
 *
 * ЧЕТЫРЕ СОСТОЯНИЯ РАЗЛИЧАЮТСЯ ЯВНО: значение получено, значение устарело,
 * значение получить не удалось, значение ещё не получено. Свести их к одному
 * «0» — самая опасная экономия в кошельке: пользователь, увидевший ноль
 * вместо недоступного баланса, решит, что средства пропали.
 *
 * ТОКЕНЫ НЕ ПОКАЗЫВАЮТСЯ, И ОБ ЭТОМ СКАЗАНО. Пустой список токенов
 * читался бы как «токенов нет».
 */
export function BalanceCard({
  balance,
  network,
  isLoading,
  error,
  onRefresh,
  action,
  portfolio = null,
  arePricesEnabled = false,
  isPortfolioLoading = false,
}: BalanceCardProps) {
  const { t } = useTranslation()
  const symbol = network?.nativeCurrency.symbol ?? ''
  const arrivals = useValueArrivals(balance?.raw ?? null)

  return (
    /* Единственная приподнятая поверхность экрана. Соседние карточки
       остаются на обычном уровне: два «главных» объекта — это уже
       отсутствие главного. */
    <Card className="surface-hero gap-4 shadow-raised inset-shadow-hairline">
      <CardHeader className="flex-row items-center justify-between gap-2">
        {/* Метка и сеть в одну строку: сложенные в столбец, они занимали
            две строки перед суммой и отодвигали её от верха карточки. */}
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          {/* ЗАГОЛОВОК ПЕРВОГО УРОВНЯ ГЛАВНОГО ЭКРАНА.

              Прежде экран не имел его вовсе: обход по заголовкам
              начинался сразу со второго уровня, и слушающий страницу
              не получал её названия. Заводить ради этого отдельную
              строку «Кошелёк» незачем — она повторяла бы подсвеченный
              пункт панели и не сообщала ничего.

              Роль отдана существующей подписи: главное на экране —
              сумма, и обход по заголовкам приводит именно к ней.
              Вид не меняется, меняется разметка. */}
          <CardTitle
            as="h1"
            className="text-xs font-medium tracking-wide text-muted-foreground uppercase"
          >
            {t('dashboard.balance')}
          </CardTitle>

          {/* Сеть вынесена из заголовка в отдельный признак. В строке
              «Balance · Ethereum» имя сети читалось как часть подписи,
              хотя это переменная величина, от которой зависит смысл
              суммы: те же цифры в другой сети — другие деньги. */}
          {network === null ? null : (
            <span className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-border/70 bg-card/60 py-0.5 pr-2 pl-1.5 text-xs font-medium">
              <span
                className={cn(
                  'size-1.5 shrink-0 rounded-full',
                  network.isTestnet ? 'bg-risk-medium' : 'bg-risk-low',
                )}
                aria-hidden
              />
              <span className="truncate">{safeText(network.name)}</span>
            </span>
          )}
        </div>

        <Button
          variant="ghost"
          size="icon"
          onClick={onRefresh}
          disabled={isLoading}
          aria-label="Refresh the balance"
        >
          <RefreshCw className={isLoading ? 'size-4 animate-spin' : 'size-4'} aria-hidden />
        </Button>
      </CardHeader>

      {/* `aria-busy` — потому что при обновлении уже показанной суммы
          единственным признаком работы остаётся вращение значка.
          Зрячий его видит, слушающий страницу — нет, и молчание
          читается как «значение окончательное». */}
      <CardContent className="flex flex-col gap-2" aria-busy={isLoading}>
        {/* Сумма — самый крупный объект приложения. Табличные цифры
            обязательны: без них разряды в соседних строках не
            выстраиваются в столбец, и суммы сравнивают на глаз.

            ПЕРЕНОС ПО СИМВОЛАМ — ЗАЩИТА ОТ ПРЕДЕЛЬНОГО ЧИСЛА. Целая
            часть суммы ничем не ограничена: у токена с шестью знаками
            и балансом близким к пределу uint256 это семьдесят с лишним
            цифр. Измерено — такое число растягивало документ до 2112
            пикселей в окне шириной 961, то есть ломало весь экран
            горизонтальной прокруткой.

            Обрезать число нельзя: показанная сумма обязана быть суммой,
            а не её началом. Поэтому оно переносится — в обычной жизни
            перенос не наступает никогда, а в предельном случае экран
            остаётся целым и значение полным. Спам-токены с
            астрономическими количествами шлют на чужие адреса
            постоянно, так что случай не выдуманный. */}
        {balance === null ? (
          <p className="text-4xl leading-none font-semibold tracking-tight text-muted-foreground tabular-nums sm:text-5xl">
            {/* «Reading…», а не «Loading…»: во всём остальном
                приложении надпись называет само действие — «Loading
                the history…», «Searching for items…», «Checking the
                approvals…». Здесь стояло единственное безымянное
                «Loading…», да ещё и самым крупным кеглем экрана. */}
            {isLoading ? 'Reading…' : '—'}
          </p>
        ) : (
          /*
            СУММА ПОДТВЕРЖДАЕТ ПРИХОД НОВОГО ЗНАЧЕНИЯ.

            До этого новая сумма подменяла прежнюю без единого признака:
            число просто оказывалось другим, и заметить подмену можно
            было, только запомнив предыдущее.

            Появление запускается ровно тогда, когда число стало ДРУГИМ:
            счётчик приходов служит ключом, и его смена пересоздаёт узел.
            При первом показе счётчик равен нулю — движения нет, иначе
            оно накладывалось бы на появление всего экрана.

            На повторных снимках с той же суммой не происходит ничего —
            и это не изъян, а граница приёма: «обновилось, но не
            изменилось» показывает остановка указателя, а не движение
            цифры. Придумывать движение там, где ничего не произошло,
            значило бы сообщать о событии, которого не было.

            ЧИСЛО НЕ «НАКРУЧИВАЕТСЯ» ОТ СТАРОГО К НОВОМУ. Такая анимация
            показывала бы суммы, которых у владельца нет ни секунды, —
            в кошельке, где нельзя показать непроверенное значение,
            это недопустимо. Появляется сразу верное, движется — подача.
          */
          <p
            key={arrivals}
            className={cn(
              'flex max-w-full flex-wrap items-baseline gap-x-2 text-4xl leading-none font-semibold tracking-tight break-all tabular-nums sm:text-5xl',
              arrivals > 0 &&
                'animate-in duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] fade-in slide-in-from-bottom-1',
            )}
          >
            {formatTokenAmount(balance.raw, balance.decimals)}
            <span className="text-xl font-medium text-muted-foreground">{symbol}</span>
          </p>
        )}

        {/* Оценка идёт сразу за суммой и до всех оговорок: это то же
            число другими словами, а не примечание к нему. */}
        <BalanceValue
          balance={balance}
          portfolio={portfolio}
          arePricesEnabled={arePricesEnabled}
          isLoading={isPortfolioLoading}
        />

        {balance !== null && balance.isStale && error === null ? (
          <p className="text-xs text-muted-foreground">
            A cached value, refresh in progress. Do not decide to send based on a stale amount.
          </p>
        ) : null}

        {error !== null ? (
          <p className="flex items-start gap-2 text-xs text-destructive">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            <span>
              The node did not answer. The value shown may be stale — that does not mean the funds
              are gone.
            </span>
          </p>
        ) : null}

        {/* ДЕЙСТВИЯ ВПЛОТНУЮ К СУММЕ, ОГОВОРКА — ПОСЛЕ НИХ. Абзац между
            цифрой и кнопками разрывал единственную связку, ради которой
            экран открывают: «столько есть — вот что можно сделать».
            Оговорка при этом никуда не делась: она нужна, но её читают
            один раз, а сумму и кнопки — каждый день. */}
        {action}

        {/* Отслеживаемые токены появились на этапе токенов, и прежняя
            оговорка «балансы ERC-20 не отслеживаются» стала неверной.
            Оставить её значило бы предупреждать о несуществующем
            ограничении, а такие предупреждения приучают не читать
            остальные. */}
        <p className="text-xs leading-relaxed text-muted-foreground">{t('dashboard.nativeOnly')}</p>
      </CardContent>
    </Card>
  )
}

interface BalanceValueProps {
  readonly balance: IBalance | null
  readonly portfolio: IPortfolioSummary | null
  readonly arePricesEnabled: boolean
  readonly isLoading: boolean
}

/**
 * Оценка показанной суммы в долларах.
 *
 * ЗАЧЕМ ОНА ЗДЕСЬ. Число в эфире не отвечает на вопрос, ради которого
 * кошелёк открывают: «1,4382 ETH» ничего не говорит человеку, который
 * не следит за курсом, а таких большинство. Доллар — единица, в которой
 * он думает о деньгах, и без неё крупнейшее число экрана остаётся для
 * него набором цифр.
 *
 * ОЦЕНКА НЕ ЗАМЕНЯЕТ СУММУ И НЕ СПОРИТ С НЕЙ ЗА ВНИМАНИЕ. Настоящая
 * величина — та, что в монетах: она точна, она подписывается, она не
 * зависит от чужого сервиса. Долларовая — производная и набрана мельче
 * и приглушённее ровно поэтому. Поменять их местами значило бы объявить
 * главным то, за что кошелёк не отвечает.
 *
 * КУРСЫ НЕ ЗАПРАШИВАЮТСЯ БЕЗ СОГЛАСИЯ, И ЭТОТ ЭКРАН ИХ НЕ ЗАПРАШИВАЕТ.
 * Обращение к источнику называет ему адреса контрактов, сеть и IP-адрес,
 * то есть выдаёт состав портфеля. Согласие берётся на экране портфеля,
 * где перечислено, что именно уйдёт наружу, а что не уйдёт. Пока его
 * нет, здесь стоит переход туда — предложение, а не тихое включение.
 *
 * ЧЕТЫРЕ СОСТОЯНИЯ РАЗЛИЧАЮТСЯ, как и у самой суммы: оценка получена,
 * оценка считается, оценку получить не удалось, оценка выключена
 * владельцем. Ноль не подставляется ни в одном из трёх последних.
 */
function BalanceValue({ balance, portfolio, arePricesEnabled, isLoading }: BalanceValueProps) {
  const { t } = useTranslation()

  /* Без баланса оценивать нечего, и строка не занимает места:
     под надписью «Reading…» цена неизвестного числа бессмысленна. */
  if (balance === null) {
    return null
  }

  if (!arePricesEnabled) {
    return (
      <Link
        to="/wallet/portfolio"
        className="focus-ring -mx-1 inline-flex w-fit items-center gap-1 rounded-md px-1 py-0.5 text-sm text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline"
      >
        {t('dashboard.valueOff')}
        <ArrowRight className="size-3.5 shrink-0" aria-hidden />
      </Link>
    )
  }

  const value = estimateNativeValue(balance, portfolio)

  if (value === null) {
    /* Пока курсы идут, «получить не удалось» было бы преждевременным
       приговором, а молчание — обещанием, что оценки не будет вовсе. */
    return (
      <p className="text-sm text-muted-foreground">
        {isLoading ? t('dashboard.valueLoading') : t('dashboard.valueUnknown')}
      </p>
    )
  }

  const quotedAt = formatQuoteTime(portfolio?.oldestQuoteAt ?? null)

  return (
    <div className="flex flex-col gap-0.5">
      {/* Табличные цифры и здесь: оценка стоит под суммой, и два числа
       с разной шириной разрядов выглядят сдвинутыми друг относительно
       друга.

       ПЕРЕНОС ДЛИННОГО ЧИСЛА — та же защита, что у самой суммы этажом
       выше. Измерено: строка «approximately $123 456 789 012 345 678
       901 234 567 890.00» выходит за свой абзац на 433 пикселя при
       ширине абзаца 238, потому что разделители разрядов местом
       переноса не считаются. Величина не выдуманная: у сети
       с многотриллионной эмиссией нативной валюты оценка выходит
       именно такой длины. `break-words` рвёт только то слово, которое
       иначе не помещается, и обычную надпись не трогает. */}
      <p className="text-lg font-medium break-words text-muted-foreground tabular-nums">
        {t('dashboard.approxValue', { value: formatFiat(value) })}
      </p>

      {/* Время котировки, а не «обновлено только что». Курс опрашивается
          раз в минуту, пока экран открыт, но при отказе источника
          на экране остаётся прежний — и отличить живое число от
          замершего можно только по времени.

          Строки нет, когда момент котировки неизвестен: выдумать его
          из текущего времени значило бы объявить свежим то, о чём
          ничего не известно. */}
      {quotedAt === null ? null : (
        <p className="text-xs text-muted-foreground/80 tabular-nums">
          {t('dashboard.rateAsOf', { time: quotedAt })}
        </p>
      )}
    </div>
  )
}

/**
 * Сколько раз приходило ОТЛИЧНОЕ от прежнего значение.
 *
 * ЗАЧЕМ СЧЁТЧИК, А НЕ САМО ЗНАЧЕНИЕ В КЛЮЧЕ. Ключом по сумме появление
 * запускалось и при первом показе — то есть при каждом заходе на экран,
 * поверх уже идущего появления всего содержимого. Два входа подряд
 * на одном объекте читаются как рябь, а не как сообщение.
 *
 * Счётчик отделяет «экран открылся» от «сумма стала другой»: при первом
 * показе он равен нулю, и движения нет вовсе. Движение остаётся ровно
 * там, где ему есть что сказать.
 *
 * ПОВТОРНЫЙ СНИМОК С ТОЙ ЖЕ СУММОЙ НИЧЕГО НЕ ЗАПУСКАЕТ: сравнивается
 * значение, а не ссылка на объект баланса, — а объект сессия
 * пересоздаёт при каждом обновлении.
 */
function useValueArrivals(value: bigint | null): number {
  const previous = useRef<bigint | null>(null)
  const [arrivals, setArrivals] = useState(0)

  useEffect(() => {
    if (previous.current !== null && value !== null && value !== previous.current) {
      setArrivals((count) => count + 1)
    }

    previous.current = value
  }, [value])

  return arrivals
}
