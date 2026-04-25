function RecordingButton({ disabled, onToggleRecording, recordingState }) {
  const isRecording = recordingState === 'recording';

  return (
    <button
      className={`control-button ${isRecording ? 'control-button--danger' : ''}`}
      disabled={disabled}
      onClick={onToggleRecording}
      type="button"
    >
      {isRecording ? 'Stop mic' : 'Start mic'}
    </button>
  );
}

export function AppHeader({
  activityLabel,
  feedbackMessage,
  feedbackTone,
  isManualRefreshing,
  isSuggestionRefreshing,
  onManualRefresh,
  onOpenSettings,
  onToggleRecording,
  recordingState,
  statusLabel,
}) {
  const isProcessing = recordingState === 'processing';
  const isRecording = recordingState === 'recording';

  return (
    <header className="app-header panel">
      <div className="app-header__copy">
        <span className="eyebrow">Live conversation workspace</span>
        <h1>TwinMind Live Suggestions</h1>
        <p>
          Record live audio, refresh grounded suggestion batches, and turn
          clicked suggestions or direct questions into fast Groq-backed answers
          inside one continuous session.
        </p>
      </div>

      <div className="app-header__controls">
        <div className="status-chip-group">
          <div className="status-chip">
            <span className={`status-dot status-dot--${recordingState}`} />
            <span>{statusLabel}</span>
          </div>
          <div className="status-chip">
            <span>{activityLabel}</span>
          </div>
        </div>

        <div className="button-row">
          <RecordingButton
            disabled={isProcessing}
            onToggleRecording={onToggleRecording}
            recordingState={recordingState}
          />
          <button
            className="control-button"
            disabled={isManualRefreshing || isSuggestionRefreshing}
            onClick={onManualRefresh}
            type="button"
          >
            {isManualRefreshing || isSuggestionRefreshing
              ? 'Refreshing...'
              : 'Manual refresh'}
          </button>
          <button
            className="control-button control-button--ghost"
            onClick={onOpenSettings}
            type="button"
          >
            Settings
          </button>
        </div>
      </div>

      <div className={`feedback-banner feedback-banner--${feedbackTone}`}>
        {feedbackMessage ||
          (isRecording
            ? 'Recording is active. Speak naturally and pause briefly between thoughts so the rolling transcript can land cleanly every few seconds.'
            : 'Open Settings to add your Groq API key before starting the microphone.')}
      </div>
    </header>
  );
}
