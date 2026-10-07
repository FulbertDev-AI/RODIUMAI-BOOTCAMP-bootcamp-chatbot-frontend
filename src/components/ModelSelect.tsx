import type { ModelOption } from '../api'

interface ModelSelectProps {
  models: ModelOption[]
  value: string
  loading: boolean
  disabled: boolean
  onChange: (modelId: string) => void
}

export default function ModelSelect({ models, value, loading, disabled, onChange }: ModelSelectProps) {
  if (loading) {
    return (
      <div className="model-select">
        <p className="muted">Chargement des modèles…</p>
      </div>
    )
  }

  if (models.length === 0) {
    return null
  }

  return (
    <div className="model-select">
      <label htmlFor="model-select">Modèle</label>
      <select
        id="model-select"
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
      >
        {models.map((model) => (
          <option key={model.id} value={model.id}>
            {model.label}
          </option>
        ))}
      </select>
    </div>
  )
}
