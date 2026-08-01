import { Languages } from 'lucide-react'

import { LANGUAGE_NAME, useTranslation, type Language } from '@/shared/i18n'
import { cn } from '@/shared/lib/utils'

export interface LanguageSwitchProps {
  readonly className?: string
}

/** Порядок кнопок постоянен: переставляющийся список труден для попадания. */
const LANGUAGES: readonly Language[] = ['ru', 'en']

/**
 * Переключатель языка интерфейса.
 *
 * ЯЗЫКИ ПОДПИСАНЫ НА СЕБЕ САМИХ. «Русский» и «English», а не «Русский»
 * и «Английский»: тот, кто не читает текущий язык, обязан узнать свой
 * в списке. Флаги не используются — флаг обозначает страну, а не язык,
 * и выбор флага для английского оскорбителен для половины его носителей.
 *
 * ВЫБРАННОЕ СОСТОЯНИЕ ПЕРЕДАЁТСЯ ЧЕРЕЗ `aria-pressed`, а не только
 * цветом: цвет как единственный признак недоступен людям с нарушением
 * цветовосприятия.
 */
export function LanguageSwitch({ className }: LanguageSwitchProps) {
  const { language, setLanguage, t } = useTranslation()

  return (
    <div className={cn('flex items-center gap-1', className)}>
      <Languages className="size-4 text-muted-foreground" aria-hidden />
      <span className="sr-only">{t('common.language')}</span>

      {LANGUAGES.map((item) => (
        <button
          key={item}
          type="button"
          aria-pressed={language === item}
          onClick={() => {
            setLanguage(item)
          }}
          className={cn(
            'rounded-lg px-2 py-1 text-xs font-medium transition-colors',
            language === item
              ? 'bg-primary/10 text-primary-emphasis'
              : 'text-muted-foreground hover:bg-accent',
          )}
        >
          {LANGUAGE_NAME[item]}
        </button>
      ))}
    </div>
  )
}
