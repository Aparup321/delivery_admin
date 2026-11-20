import { useState, type FormEvent } from 'react'
import {
  DEFAULT_SUSPENSION_DAYS,
  MAX_SUSPENSION_DAYS,
  MIN_SUSPENSION_DAYS,
  formatSuspensionEnd,
  isValidSuspensionDays,
  suspensionDaysLabel,
  suspensionEnd,
} from '../domain/suspension'
import { Button, Dialog, Icon } from './ui'

const PRESETS = [1, 3, 7, 14, 30]

interface Props {
  partnerName: string
  detail: string
  onCancel: () => void
  onConfirm: (reason: string, durationDays: number) => void
}

/** Suspension decision with an explicit day-based timeline and automatic end. */
export function SuspendPartnerDialog({ partnerName, detail, onCancel, onConfirm }: Props) {
  const [days, setDays] = useState(String(DEFAULT_SUSPENSION_DAYS))
  const [reason, setReason] = useState('')
  const [error, setError] = useState('')
  const duration = Number(days)
  const validDuration = isValidSuspensionDays(duration)
  const end = validDuration ? formatSuspensionEnd(suspensionEnd(new Date().toISOString(), duration)) : null

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!validDuration) {
      setError(`Enter a whole number from ${MIN_SUSPENSION_DAYS} to ${MAX_SUSPENSION_DAYS} days.`)
      return
    }
    if (!reason.trim()) {
      setError('Add a suspension reason.')
      return
    }
    onConfirm(reason.trim(), duration)
  }

  return <Dialog title={`Suspend ${partnerName}?`} eyebrow="PARTNER SUSPENSION" onClose={onCancel}>
    <form className="dialog-form suspension-dialog" onSubmit={submit}>
      <p className="dialog-description">{detail}</p>

      <div className="suspension-duration">
        <label className="field-label">Suspension length (days)<input type="number" min={MIN_SUSPENSION_DAYS} max={MAX_SUSPENSION_DAYS} step={1} required autoFocus value={days} onChange={(event) => { setDays(event.target.value); setError('') }} /><span className="field-help">The partner is reinstated automatically when the period ends.</span></label>
        <div className="suspension-presets" role="group" aria-label="Quick suspension lengths">
          {PRESETS.map((preset) => <button type="button" key={preset} className={duration === preset ? 'active' : ''} aria-pressed={duration === preset} onClick={() => { setDays(String(preset)); setError('') }}>{preset}d</button>)}
        </div>
      </div>

      <div className={`suspension-preview ${validDuration ? '' : 'is-invalid'}`}>
        <span className="suspension-preview-icon"><Icon name="calendar" size={16} /></span>
        <div>
          <strong>{validDuration ? `${suspensionDaysLabel(duration)} suspension` : 'Choose a suspension length'}</strong>
          <span>{validDuration && end ? `Ends ${end} · eligibility restored automatically` : `Enter ${MIN_SUSPENSION_DAYS}–${MAX_SUSPENSION_DAYS} whole days to see the timeline.`}</span>
        </div>
      </div>

      <label className="field-label">Suspension reason<textarea rows={3} maxLength={240} required value={reason} onChange={(event) => { setReason(event.target.value); setError('') }} placeholder="Explain why this partner is being suspended" /></label>
      {error && <div className="admin-form-error" role="alert"><Icon name="alert" size={15} /><span>{error}</span></div>}

      <div className="dialog-actions"><Button onClick={onCancel}>Cancel</Button><Button type="submit" variant="danger" disabled={!validDuration}><Icon name="shield" size={14} />Suspend for {validDuration ? suspensionDaysLabel(duration) : '…'}</Button></div>
    </form>
  </Dialog>
}
