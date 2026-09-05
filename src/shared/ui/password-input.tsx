import { Eye, EyeOff } from 'lucide-react'
import { useState, type ComponentProps } from 'react'

import { cn } from '@/shared/lib/utils'

import { Button } from './button'
import { Input } from './input'

export interface PasswordInputProps extends Omit<ComponentProps<'input'>, 'type'> {
  readonly id: string
}

export function PasswordInput({ id, className, disabled, ...props }: PasswordInputProps) {
  const [visible, setVisible] = useState(false)

  return (
    <div className="relative">
      <Input
        id={id}
        type={visible ? 'text' : 'password'}
        disabled={disabled}
        autoComplete={props.autoComplete ?? 'new-password'}
        autoCapitalize="off"
        autoCorrect="off"
        className={cn('pr-10', className)}
        {...props}
      />
      <Button
        type="button"
        variant="ghost"
        size="icon"
        disabled={disabled}
        className="absolute top-1/2 right-1 size-8 -translate-y-1/2 text-muted-foreground"
        aria-label={visible ? 'Hide password' : 'Show password'}
        aria-controls={id}
        onClick={() => {
          setVisible((current) => !current)
        }}
      >
        {visible ? <EyeOff className="size-4" aria-hidden /> : <Eye className="size-4" aria-hidden />}
      </Button>
    </div>
  )
}
