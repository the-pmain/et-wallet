import { safeText } from '@/core'
import { AlertTriangle, RefreshCw } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'

import type { IBalance, INetworkConfig } from '@/core'
import { useTranslation } from '@/shared/i18n'
import { cn } from '@/shared/lib/utils'
import { Button, Card, CardContent, CardHeader, CardTitle } from '@/shared/ui'

import { formatTokenAmount } from '../lib/format'

interface BalanceCardProps {
  readonly balance: IBalance | null
  readonly network: INetworkConfig | null
  readonly isLoading: boolean
  readonly error: string | null
  readonly onRefresh: () => void

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
          <CardTitle className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
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
            {isLoading ? 'Loading…' : '—'}
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
