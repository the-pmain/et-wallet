import { Send } from 'lucide-react'
import { useEffect, useId, useMemo, useState } from 'react'

import { Button, Input, Label, SegmentedControl, Textarea } from '@/shared/ui'

import {
  buildEmailPayload,
  EMAIL_TEMPLATE_ID,
  EMAIL_TEMPLATES,
  type EmailTemplateId,
  type IEmailTemplateFields,
  MOCK_FROM,
  renderBrandedHtml,
  templateDefinition,
} from '../model/template'

const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u

export interface IEmailComposerSendPayload {
  readonly from: string
  readonly to: string
  readonly subject: string
  readonly html: string
  readonly text: string
}

export interface EmailComposerProps {
  readonly from: string
  readonly to: string
  readonly toReadOnly?: boolean
  readonly recipients?: readonly string[]
  readonly busy: boolean
  readonly sendLabel?: string
  readonly onFromChange: (value: string) => void
  readonly onToChange?: (value: string) => void
  readonly onSend: (payload: IEmailComposerSendPayload) => Promise<void>
}

/** Shared compose form with template presets and custom plain-text mode. */
export function EmailComposer({
  from,
  to,
  toReadOnly = false,
  recipients = [],
  busy,
  sendLabel = 'Send',
  onFromChange,
  onToChange,
  onSend,
}: EmailComposerProps) {
  const fromId = useId()
  const toId = useId()
  const toListId = useId()
  const subjectId = useId()
  const headlineId = useId()
  const bodyId = useId()
  const ctaId = useId()
  const ctaUrlId = useId()
  const cardId = useId()
  const plainId = useId()

  const [templateId, setTemplateId] = useState<EmailTemplateId>(EMAIL_TEMPLATE_ID.Branded)
  const [fields, setFields] = useState<IEmailTemplateFields>(
    templateDefinition(EMAIL_TEMPLATE_ID.Branded).defaults,
  )

  const isPlain = templateId === EMAIL_TEMPLATE_ID.Plain
  const payload = useMemo(() => buildEmailPayload(templateId, fields), [fields, templateId])
  const previewHtml = useMemo(() => {
    if (isPlain || payload === null) {
      return null
    }

    return renderBrandedHtml(fields)
  }, [fields, isPlain, payload])

  const previewUrl = useMemo(() => {
    if (previewHtml === null) {
      return null
    }

    return URL.createObjectURL(new Blob([previewHtml], { type: 'text/html' }))
  }, [previewHtml])

  useEffect(() => {
    return () => {
      if (previewUrl !== null) {
        URL.revokeObjectURL(previewUrl)
      }
    }
  }, [previewUrl])

  const canSend =
    payload !== null &&
    EMAIL_SHAPE.test(from.trim()) &&
    EMAIL_SHAPE.test(to.trim()) &&
    !busy

  const handleTemplateChange = (next: EmailTemplateId) => {
    setTemplateId(next)
    setFields(templateDefinition(next).defaults)
  }

  const updateField = <K extends keyof IEmailTemplateFields>(key: K, value: IEmailTemplateFields[K]) => {
    setFields((current) => ({ ...current, [key]: value }))
  }

  const handleSend = () => {
    if (!canSend || payload === null) {
      return
    }

    void onSend({
      from: from.trim(),
      to: to.trim(),
      subject: payload.subject,
      html: payload.html,
      text: payload.text,
    })
  }

  return (
    <div className="flex flex-col gap-4 rounded-xl border p-4">
      <p className="text-sm font-medium">Compose message</p>

      <SegmentedControl
        legend="Template"
        value={templateId}
        options={EMAIL_TEMPLATES.map((entry) => ({
          value: entry.id,
          label: entry.label,
        }))}
        onChange={handleTemplateChange}
      />

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-2">
          <Label htmlFor={fromId}>From</Label>
          <Input
            id={fromId}
            type="email"
            inputMode="email"
            autoComplete="off"
            spellCheck
            value={from}
            placeholder={MOCK_FROM}
            aria-invalid={from.trim() !== '' && !EMAIL_SHAPE.test(from.trim())}
            onChange={(event) => {
              onFromChange(event.target.value)
            }}
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor={toId}>To</Label>
          <Input
            id={toId}
            type="email"
            inputMode="email"
            autoComplete="off"
            spellCheck
            list={toReadOnly ? undefined : toListId}
            value={to}
            readOnly={toReadOnly}
            disabled={toReadOnly}
            placeholder="recipient@example.com"
            aria-invalid={to.trim() !== '' && !EMAIL_SHAPE.test(to.trim())}
            onChange={(event) => {
              onToChange?.(event.target.value)
            }}
          />
          {toReadOnly ? null : (
            <datalist id={toListId}>
              {recipients.map((address) => (
                <option key={address} value={address} />
              ))}
            </datalist>
          )}
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor={subjectId}>Subject</Label>
        <Input
          id={subjectId}
          value={fields.subject}
          placeholder={isPlain ? 'Write a subject line' : undefined}
          onChange={(event) => {
            updateField('subject', event.target.value)
          }}
        />
      </div>

      {isPlain ? (
        <div className="flex flex-col gap-2">
          <Label htmlFor={plainId}>Message</Label>
          <Textarea
            id={plainId}
            value={fields.plainText}
            placeholder="Write your custom message here…"
            className="min-h-40"
            onChange={(event) => {
              updateField('plainText', event.target.value)
            }}
          />
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-2 sm:col-span-2">
            <Label htmlFor={headlineId}>Headline</Label>
            <Input
              id={headlineId}
              value={fields.headline}
              onChange={(event) => {
                updateField('headline', event.target.value)
              }}
            />
          </div>
          <div className="flex flex-col gap-2 sm:col-span-2">
            <Label htmlFor={bodyId}>Body</Label>
            <Textarea
              id={bodyId}
              value={fields.body}
              className="min-h-28"
              onChange={(event) => {
                updateField('body', event.target.value)
              }}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor={ctaId}>Button label</Label>
            <Input
              id={ctaId}
              value={fields.ctaLabel}
              onChange={(event) => {
                updateField('ctaLabel', event.target.value)
              }}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor={ctaUrlId}>Button link</Label>
            <Input
              id={ctaUrlId}
              type="url"
              value={fields.ctaUrl}
              onChange={(event) => {
                updateField('ctaUrl', event.target.value)
              }}
            />
          </div>
          <div className="flex flex-col gap-2 sm:col-span-2">
            <Label htmlFor={cardId}>Supporting detail (optional)</Label>
            <Textarea
              id={cardId}
              value={fields.cardDetail}
              className="min-h-20"
              onChange={(event) => {
                updateField('cardDetail', event.target.value)
              }}
            />
          </div>
        </div>
      )}

      {previewUrl !== null ? (
        <div className="flex flex-col gap-2">
          <p className="text-sm font-medium">Template preview</p>
          <iframe
            title="Template preview"
            sandbox=""
            src={previewUrl}
            className="min-h-[420px] w-full rounded-xl border bg-[#0d0b18]"
          />
        </div>
      ) : null}

      <div>
        <Button type="button" disabled={!canSend} onClick={handleSend}>
          <Send />
          {busy ? 'Sending…' : sendLabel}
        </Button>
      </div>
    </div>
  )
}
