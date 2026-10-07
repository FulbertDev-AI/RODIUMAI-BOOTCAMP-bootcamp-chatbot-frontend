import { useState, type FormEvent } from 'react'

interface NoteComposerProps {
  disabled: boolean
  onCreate: (content: string) => Promise<void>
}

export default function NoteComposer({ disabled, onCreate }: NoteComposerProps) {
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)
  const canSubmit = !disabled && !saving && Boolean(draft.trim())

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    const content = draft.trim()
    if (!content || disabled || saving) return
    setSaving(true)
    try {
      await onCreate(content)
      setDraft('')
    } catch {
      // The parent surfaces the error; keep the draft so the student can retry.
    } finally {
      setSaving(false)
    }
  }

  return (
    <form className="note-composer" onSubmit={handleSubmit}>
      <p className="note-composer-title">📝 Ajouter une note</p>
      <textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        placeholder="Je dois revoir les listes Python ce soir."
        rows={2}
        disabled={disabled || saving}
      />
      <button type="submit" disabled={!canSubmit}>
        {saving ? 'Ajout…' : 'Ajouter la note'}
      </button>
    </form>
  )
}
