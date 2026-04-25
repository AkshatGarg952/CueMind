import {
  DEFAULT_AUDIO_CHUNK_INTERVAL_MS,
  MAX_AUDIO_CHUNK_INTERVAL_MS,
  MIN_AUDIO_CHUNK_INTERVAL_MS,
} from '@shared/audioFormats.js';

function NumberField({ label, max, min = '0', onChange, step = '1', value }) {
  return (
    <label className="field">
      <span className="field__label">{label}</span>
      <input
        className="field__input"
        max={max}
        min={min}
        onChange={(event) => onChange(Number(event.target.value))}
        step={step}
        type="number"
        value={value}
      />
    </label>
  );
}

function TextField({ label, onChange, placeholder, type = 'text', value }) {
  return (
    <label className="field">
      <span className="field__label">{label}</span>
      <input
        className="field__input"
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        type={type}
        value={value}
      />
    </label>
  );
}

function TextAreaField({ label, onChange, rows = 5, value }) {
  return (
    <label className="field">
      <span className="field__label">{label}</span>
      <textarea
        className="field__input field__input--textarea"
        onChange={(event) => onChange(event.target.value)}
        rows={rows}
        value={value}
      />
    </label>
  );
}

export function SettingsModal({
  isOpen,
  onClose,
  onSettingsChange,
  settings,
}) {
  if (!isOpen) {
    return null;
  }

  function updateRootField(field, value) {
    onSettingsChange((currentSettings) => ({
      ...currentSettings,
      [field]: value,
    }));
  }

  function updateNestedField(group, field, value) {
    onSettingsChange((currentSettings) => ({
      ...currentSettings,
      [group]: {
        ...currentSettings[group],
        [field]: value,
      },
    }));
  }

  return (
    <div className="modal-overlay" role="presentation">
      <div
        aria-labelledby="settings-title"
        aria-modal="true"
        className="modal panel"
        role="dialog"
      >
        <div className="panel-heading">
          <div>
            <span className="eyebrow">Settings</span>
            <h2 id="settings-title">Groq and prompt configuration</h2>
          </div>
          <button
            aria-label="Close settings"
            className="control-button control-button--ghost"
            onClick={onClose}
            type="button"
          >
            Close
          </button>
        </div>

        <div className="settings-grid">
          <TextField
            label="Groq API key"
            onChange={(value) => updateRootField('groqApiKey', value)}
            placeholder="Paste your Groq API key"
            type="password"
            value={settings.groqApiKey}
          />

          <NumberField
            label="Refresh interval (ms)"
            max={MAX_AUDIO_CHUNK_INTERVAL_MS}
            min={MIN_AUDIO_CHUNK_INTERVAL_MS}
            onChange={(value) => updateRootField('refreshIntervalMs', value)}
            step="1000"
            value={settings.refreshIntervalMs}
          />

          <NumberField
            label="Suggestion context window"
            onChange={(value) =>
              updateNestedField('contextWindows', 'suggestions', value)
            }
            value={settings.contextWindows.suggestions}
          />

          <NumberField
            label="Answer context window"
            onChange={(value) =>
              updateNestedField('contextWindows', 'answers', value)
            }
            value={settings.contextWindows.answers}
          />

          <NumberField
            label="Suggestion temperature"
            onChange={(value) =>
              updateNestedField('modelConfig', 'suggestionsTemperature', value)
            }
            step="0.1"
            value={settings.modelConfig.suggestionsTemperature}
          />

          <NumberField
            label="Chat temperature"
            onChange={(value) =>
              updateNestedField('modelConfig', 'chatTemperature', value)
            }
            step="0.1"
            value={settings.modelConfig.chatTemperature}
          />

          <label className="field field--checkbox">
            <span className="field__label">Avoid duplicate suggestions</span>
            <input
              checked={settings.guardrails.avoidDuplicateSuggestions}
              onChange={(event) =>
                updateNestedField(
                  'guardrails',
                  'avoidDuplicateSuggestions',
                  event.target.checked,
                )
              }
              type="checkbox"
            />
          </label>

          <label className="field field--checkbox">
            <span className="field__label">Reject generic suggestions</span>
            <input
              checked={settings.guardrails.rejectGenericSuggestions}
              onChange={(event) =>
                updateNestedField(
                  'guardrails',
                  'rejectGenericSuggestions',
                  event.target.checked,
                )
              }
              type="checkbox"
            />
          </label>

          <NumberField
            label="Minimum type variety"
            max="3"
            min="2"
            onChange={(value) =>
              updateNestedField('guardrails', 'minimumSuggestionTypeVariety', value)
            }
            value={settings.guardrails.minimumSuggestionTypeVariety}
          />

          <NumberField
            label="Suggestion history batches"
            max="6"
            min="1"
            onChange={(value) =>
              updateNestedField('guardrails', 'suggestionHistoryBatches', value)
            }
            value={settings.guardrails.suggestionHistoryBatches}
          />

          <div className="field field--note">
            Settings persist locally in the browser for this scaffold so prompt
            and tuning changes survive refresh while staying client-side.
            Audio capture is clamped between {MIN_AUDIO_CHUNK_INTERVAL_MS / 1000}
            {' '}
            and {MAX_AUDIO_CHUNK_INTERVAL_MS / 1000} seconds per chunk for more
            reliable transcription. The default interval is
            {' '}
            {DEFAULT_AUDIO_CHUNK_INTERVAL_MS / 1000}
            seconds for a lower-latency live demo, while suggestions are paced
            separately so they do not refresh after every tiny audio chunk.
          </div>
        </div>

        <div className="settings-stack">
          <TextAreaField
            label="Live suggestion prompt"
            onChange={(value) => updateNestedField('prompts', 'liveSuggestion', value)}
            rows={7}
            value={settings.prompts.liveSuggestion}
          />

          <TextAreaField
            label="Detailed answer prompt"
            onChange={(value) => updateNestedField('prompts', 'detailedAnswer', value)}
            rows={6}
            value={settings.prompts.detailedAnswer}
          />

          <TextAreaField
            label="Chat prompt"
            onChange={(value) => updateNestedField('prompts', 'chat', value)}
            rows={5}
            value={settings.prompts.chat}
          />
        </div>
      </div>
    </div>
  );
}
