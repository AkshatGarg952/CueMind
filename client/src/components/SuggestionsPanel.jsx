function formatTime(value) {
  return new Date(value).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });
}

function SuggestionCard({
  activeSuggestionId,
  isChatResponding,
  onSuggestionSelect,
  suggestion,
}) {
  const isActive = activeSuggestionId === suggestion.id;

  return (
    <button
      className="card suggestion-card"
      disabled={isChatResponding}
      onClick={() => onSuggestionSelect(suggestion)}
      type="button"
    >
      <div className="card-meta">
        <span className="pill">{suggestion.type.replace('_', ' ')}</span>
        <span>
          {isActive ? 'Generating...' : formatTime(suggestion.createdAt)}
        </span>
      </div>
      <h3>{suggestion.title}</h3>
      <p>{suggestion.preview}</p>
      {suggestion.reason ? (
        <span className="suggestion-reason">{suggestion.reason}</span>
      ) : null}
    </button>
  );
}

export function SuggestionsPanel({
  activeSuggestionId,
  isChatResponding,
  isSuggestionRefreshing,
  onSuggestionSelect,
  statusMessage,
  suggestionBatches,
}) {
  return (
    <section className="panel panel-column">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">Suggestions</span>
          <h2>Live suggestion batches</h2>
        </div>
        <span className="count-badge">{suggestionBatches.length} batches</span>
      </div>

      <div className="panel-scroll">
        {suggestionBatches.length === 0 ? (
          <div className="empty-state">
            {isSuggestionRefreshing
              ? 'TwinMind is generating the first suggestion batch from the latest transcript context.'
              : 'Suggestion batches will stack here, newest first. Record at least one transcript chunk or use manual refresh after the first transcript arrives.'}
          </div>
        ) : (
          <div className="stack-list">
            {isSuggestionRefreshing ? (
              <div className="feedback-banner feedback-banner--info">
                {statusMessage || 'Generating a fresh suggestion batch...'}
              </div>
            ) : null}
            {suggestionBatches.map((batch) => (
              <section className="batch-group" key={batch.id}>
                <div className="batch-heading">
                  <span>Batch generated at {formatTime(batch.createdAt)}</span>
                  <span>{batch.suggestions.length} suggestions</span>
                </div>

                <div className="stack-list">
                  {batch.suggestions.map((suggestion) => (
                    <SuggestionCard
                      activeSuggestionId={activeSuggestionId}
                      isChatResponding={isChatResponding}
                      key={suggestion.id}
                      onSuggestionSelect={onSuggestionSelect}
                      suggestion={suggestion}
                    />
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
