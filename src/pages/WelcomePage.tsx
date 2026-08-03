import { ArrowRight, Download, Fingerprint, ShieldCheck, Zap } from 'lucide-react'
import { Link } from 'react-router'

import { APP_CONFIG, TEST_MODE } from '@/shared/config'
import { useTranslation } from '@/shared/i18n'
import { Alert, AlertDescription, BrandMark, Button } from '@/shared/ui'

/**
 * Первый экран приложения.
 *
 * Два равнозначных пути: создать кошелёк либо импортировать существующий.
 * Создание не выделено как «рекомендуемое»: пользователь, пришедший
 * с готовой seed-фразой, не должен искать кнопку импорта среди
 * второстепенных — попытка «просто создать» приведёт его к новому пустому
 * кошельку и уверенности, что средства пропали.
 *
 * ЗДЕСЬ НЕТ ВХОДА В УЧЁТНУЮ ЗАПИСЬ, И ЭТО НЕ УПУЩЕНИЕ. Кошелёк
 * некастодиальный: учётной записи не существует, входить некуда. Кнопка
 * «Войти» отправила бы пользователя искать логин и пароль, которых нет,
 * а заодно создала бы ложное впечатление, что доступ к средствам можно
 * восстановить через поддержку.
 *
 * ФИРМЕННЫЙ БЛОК ЗАНИМАЕТ ВЕРХ ЭКРАНА, а не украшает угол: это
 * единственное место, где пользователь запоминает, как выглядит настоящее
 * приложение. Узнаваемый вид — слабая, но реальная защита от фишинговой
 * копии, и чем он заметнее, тем лучше работает.
 */
export function WelcomePage() {
  const { t } = useTranslation()

  /* Отступы рассчитаны на окно расширения высотой около 600 пикселей:
     первый экран обязан помещаться целиком, иначе кнопка импорта
     оказывается за краем и пользователь её не находит. */
  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-6 px-5 py-6">
      {/* Переключатель языка стоит на первом экране: выбрать язык нужно
          раньше, чем читать предупреждения о рисках. */}

      <header className="flex w-full max-w-xl flex-col items-center gap-4 text-center">
        <BrandMark className="size-14 animate-in drop-shadow-xl duration-700 zoom-in-90 fade-in" />

        <div className="flex animate-in flex-col gap-3 delay-100 duration-700 fill-mode-both fade-in slide-in-from-bottom-4">
          <p className="text-xs font-semibold tracking-[0.28em] text-primary-emphasis uppercase">
            {t('welcome.tagline')}
          </p>

          {/*
            Значки внутри заголовка — визуальный ритм, а не смысловая
            нагрузка: каждый из них продублирован словом рядом,
            и `aria-hidden` убирает их из чтения экранным диктором.
          */}
          {/*
            Пробелы вокруг значков заданы явно. Отступ `mx-1.5` разделяет
            слова визуально, но не в тексте: экранный диктор прочитал бы
            «ключиостаются» слитно.
          */}
          {/* Заголовок берётся из словаря целиком, а не собирается
              из кусков вокруг значков: порядок слов в языках разный,
              и склейка «первая половина + значок + вторая» дала бы
              в английском бессмыслицу. Значки вынесены к краям. */}
          <h1 className="font-display text-3xl leading-[1.1] font-bold tracking-tight text-balance sm:text-4xl">
            <Zap className="mx-0.5 inline size-6 align-middle text-primary-emphasis" aria-hidden />{' '}
            {t('welcome.headline')}{' '}
            <Fingerprint
              className="mx-0.5 inline size-6 align-middle text-primary-emphasis"
              aria-hidden
            />
          </h1>

          <p className="text-sm leading-relaxed text-balance text-muted-foreground">
            {t('welcome.subtitle', { app: APP_CONFIG.name })}
          </p>
        </div>
      </header>

      <div className="flex w-full max-w-sm animate-in flex-col gap-3 delay-200 duration-700 fill-mode-both slide-in-from-bottom-5 fade-in">
        <Button
          asChild
          size="lg"
          className="h-13 w-full justify-between rounded-full px-6 shadow-lg shadow-primary/25"
        >
          <Link to="/create">
            {t('welcome.create')}
            <ArrowRight className="size-5" aria-hidden />
          </Link>
        </Button>

        {/* ВРЕМЕННОЕ ПОСЛАБЛЕНИЕ. Вход по seed-фразе скрыт флагом
            в `shared/config/test-mode.ts`. Вместе с ним исчезает
            единственный способ восстановления кошелька: забытый пароль
            означает, что расшифровать хранилище будет нечем. */}
        {TEST_MODE.hideSeedImport ? null : (
          <Button
            asChild
            variant="outline"
            size="lg"
            className="h-13 w-full justify-between rounded-full bg-card/60 px-6 backdrop-blur-sm"
          >
            <Link to="/import">
              {t('welcome.import')}
              <Download className="size-5" aria-hidden />
            </Link>
          </Button>
        )}
      </div>

      {/*
        Одно предупреждение, а не два. Два соседних блока одинаковой
        важности конкурируют за внимание, и читатель пропускает оба;
        к тому же на экране всплывающего окна расширения второй блок
        уводил кнопки за нижний край.
      */}
      <Alert className="w-full max-w-sm animate-in bg-card/70 backdrop-blur-sm delay-300 duration-700 fill-mode-both fade-in">
        <ShieldCheck />
        <AlertDescription>
          {TEST_MODE.hideSeedImport ? t('welcome.noticeTestMode') : t('welcome.notice')}
        </AlertDescription>
      </Alert>

      {/* ССЫЛКА, А НЕ ВТОРОЙ БЛОК ПРЕДУПРЕЖДЕНИЯ — см. пояснение выше:
          два равновесных блока рядом соперничают за внимание. Риск,
          о котором она говорит, реален, но в момент создания кошелька
          seed-фраза важнее, и вытеснять её нельзя. */}
      <Link
        to="/trust"
        className="animate-in text-xs text-muted-foreground underline-offset-4 delay-500 duration-700 fill-mode-both fade-in hover:text-foreground hover:underline"
      >
        {t('welcome.trust')}
      </Link>
    </div>
  )
}
