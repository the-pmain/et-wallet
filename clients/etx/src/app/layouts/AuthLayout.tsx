import type { CSSProperties } from 'react'
import { NavigationType, Outlet, useLocation, useNavigationType } from 'react-router'

import { cn } from '@/shared/lib/utils'

import { COINS, type ICoin } from './coins'

/**
 * Оболочка экранов входа.
 *
 * Общий живой фон для приветствия, создания, восстановления, разблокировки
 * и сброса. Вынесен в маршрут-лейаут, а не повторён в каждой странице:
 * пять копий разошлись бы, а при переходе между экранами фон перезапускал
 * бы анимацию с нуля — движение читалось бы как рывок.
 *
 * ЗА ПАНЕЛЬЮ КОШЕЛЬКА ЭТОГО ФОНА НЕТ. Движение позади сумм и предупреждений
 * мешает читать и перетягивает внимание. Экраны входа — единственное место,
 * где на экране нет ни одной цифры, за которую пользователь отвечает
 * деньгами, и украшение уместно.
 */
export function AuthLayout() {
  const location = useLocation()
  const navigationType = useNavigationType()

  /* Направление перехода: «назад» выводит содержимое слева, «вперёд» —
     справа. Совпадение направления анимации с направлением движения
     по истории — то, что делает переход понятным, а не просто плавным.

     Сравнение через перечисление библиотеки, а не со строкой: строковый
     литерал не проверяется компилятором, и опечатка обернулась бы
     переходами, всегда идущими в одну сторону. */
  const isBackwards = navigationType === NavigationType.Pop

  return (
    <div className="relative min-h-svh overflow-hidden bg-background">
      <AuroraBackground />

      {/*
        Ключ по адресу перезапускает анимацию при каждом переходе.
        Фон при этом остаётся на месте: меняется только содержимое,
        и смена читается как продолжение одного экрана, а не как
        загрузка нового.
      */}
      <div
        key={location.pathname}
        className={cn(
          'relative z-10 animate-in duration-500 fade-in',
          isBackwards ? 'slide-in-from-left-8' : 'slide-in-from-right-8',
        )}
      >
        <Outlet />
      </div>
    </div>
  )
}

/**
 * Живой фон: градиентные пятна, падающие монеты, сетка и виньетка.
 *
 * Разметка сознательно пустая: всё оформление живёт в CSS, а элементы
 * здесь — только слои. `aria-hidden` обязателен: экранному диктору
 * нечего сообщить о фоне, а лишние узлы засоряют навигацию.
 */
function AuroraBackground() {
  return (
    <div className="aurora" aria-hidden>
      <div className="aurora-blob aurora-blob-primary" />
      <div className="aurora-blob aurora-blob-secondary" />
      <div className="aurora-blob aurora-blob-accent" />

      <CoinRain />

      <div className="aurora-grid" />
      <div className="aurora-vignette" />
    </div>
  )
}

/**
 * Медленно падающие монеты.
 *
 * ПОЧЕМУ CSS, А НЕ CANVAS. Холст требует непрерывного цикла на главном
 * потоке: пока открыт кошелёк, процессор занят перерисовкой украшения.
 * Здесь анимируется только `transform`, и браузер выполняет это
 * на видеокарте, не будя главный поток вовсе.
 *
 * ПОЧЕМУ ПОЛОЖЕНИЯ ЗАДАНЫ СПИСКОМ, А НЕ СЛУЧАЙНЫ. `Math.random` дал бы
 * разную картину при каждом рендере: тесты стали бы недетерминированными,
 * а сама раскладка иногда сбивалась бы в кучу. Значения подобраны так,
 * чтобы монеты распределялись по ширине и не совпадали по фазе.
 *
 * Слой скрывается целиком при системной настройке уменьшенного движения —
 * см. `index.css`. Обычного отключения анимации здесь мало: монеты
 * замерли бы у нижнего края видимой грудой.
 */
function CoinRain() {
  return (
    <div className="coin-rain">
      {COINS.map((coin, index) => (
        <span key={index} className="coin" style={coinStyle(coin)} />
      ))}
    </div>
  )
}

/**
 * Стиль одной монеты.
 *
 * Пользовательские свойства CSS не входят в `CSSProperties`, поэтому тип
 * расширен явно. Приведение к `any` решило бы ту же задачу, но заодно
 * отключило бы проверку остальных полей — а опечатка в `animationDuration`
 * не выдала бы себя ничем, кроме неподвижной монеты.
 */
type CoinStyle = CSSProperties & {
  readonly '--coin-drift': string
  readonly '--coin-opacity': string
  readonly '--coin-spin': string
}

function coinStyle(coin: ICoin): CoinStyle {
  return {
    left: `${String(coin.left)}%`,
    width: `${String(coin.size)}px`,
    height: `${String(coin.size)}px`,
    animationDuration: `${String(coin.duration)}s`,
    animationDelay: `${String(coin.delay)}s`,
    '--coin-drift': `${String(coin.drift)}px`,
    '--coin-opacity': String(coin.opacity),
    '--coin-spin': `${String(coin.spin)}deg`,
  }
}
