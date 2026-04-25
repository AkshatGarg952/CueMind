export function ServerWarmupScreen({
  attemptCount,
  errorMessage,
  isRetrying,
  onRetryNow,
  statusMessage,
}) {
  return (
    <div className="app-shell app-shell--centered">
      <div className="app-shell__backdrop" />
      <div className="app-shell__content app-shell__content--centered">
        <section className="panel warmup-panel">
          <div className="warmup-panel__copy">
            <span className="eyebrow">Backend warm-up</span>
            <h1>Waking the TwinMind server</h1>
            <p>
              The Render backend is being pinged now. The workspace stays locked
              until the health API responds so the first user actions do not hit
              a sleeping server.
            </p>
          </div>

          <div className="warmup-panel__status">
            <div className="status-chip">
              <span className={`status-dot status-dot--${isRetrying ? 'processing' : 'idle'}`} />
              <span>{isRetrying ? 'Checking server' : 'Waiting for wake-up'}</span>
            </div>
            <div className="status-chip">
              <span>Attempt {Math.max(attemptCount, 1)}</span>
            </div>
          </div>

          <div className="feedback-banner feedback-banner--info">
            {statusMessage}
          </div>

          {errorMessage ? (
            <div className="feedback-banner feedback-banner--error">
              Last health check: {errorMessage}
            </div>
          ) : null}

          <div className="warmup-panel__actions">
            <button
              className="control-button"
              disabled={isRetrying}
              onClick={onRetryNow}
              type="button"
            >
              {isRetrying ? 'Checking...' : 'Retry now'}
            </button>
            <span className="warmup-panel__hint">
              Auto-retrying every few seconds until the backend wakes up.
            </span>
          </div>
        </section>
      </div>
    </div>
  );
}
