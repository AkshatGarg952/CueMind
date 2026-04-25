import { useEffect, useRef } from 'react';

function formatTime(value) {
  return new Date(value).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function ChatPanel({
  chatDraft,
  chatErrorMessage,
  chatMessages,
  hasSessionActivity,
  isBusy,
  onChatDraftChange,
  onExportJson,
  onExportText,
  onSendMessage,
}) {
  const scrollContainerRef = useRef(null);

  function handleExportChange(event) {
    const exportFormat = event.target.value;

    if (exportFormat === 'json') {
      onExportJson();
    }

    if (exportFormat === 'text') {
      onExportText();
    }

    event.target.value = '';
  }

  useEffect(() => {
    const scrollContainer = scrollContainerRef.current;

    if (!scrollContainer) {
      return;
    }

    scrollContainer.scrollTo({
      top: scrollContainer.scrollHeight,
      behavior: chatMessages.length > 1 ? 'smooth' : 'auto',
    });
  }, [chatMessages.length]);

  return (
    <section className="panel panel-column panel--chat">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">Chat</span>
          <h2>Detailed answers</h2>
        </div>
        <div className="panel-heading__aside">
          <span className="count-badge">{chatMessages.length} messages</span>
          <select
            aria-label="Export session"
            className="export-select"
            defaultValue=""
            disabled={!hasSessionActivity}
            onChange={handleExportChange}
          >
            <option value="" disabled>
              Export
            </option>
            <option value="json">JSON</option>
            <option value="text">Text</option>
          </select>
        </div>
      </div>

      <div className="panel-scroll" ref={scrollContainerRef}>
        {chatMessages.length === 0 ? (
          <div className="empty-state">
            Click a suggestion to expand it into a longer answer, or ask a
            direct question here to keep the whole session in one running chat.
          </div>
        ) : (
          <div className="stack-list">
            {chatMessages.map((message) => (
              <article
                className={`chat-bubble chat-bubble--${message.role}`}
                key={message.id}
              >
                <div className="card-meta">
                  <span>{labelForMessage(message)}</span>
                  <span>{formatTime(message.createdAt)}</span>
                </div>
                <p>{message.text}</p>
              </article>
            ))}
          </div>
        )}
      </div>

      <form className="chat-form" onSubmit={onSendMessage}>
        {isBusy ? (
          <div className="chat-inline-status">
            Generating the next answer from the current session context...
          </div>
        ) : null}
        {chatErrorMessage ? (
          <div className="feedback-banner feedback-banner--error">
            {chatErrorMessage}
          </div>
        ) : null}

        <div className="chat-input-row">
          <input
            aria-label="Direct question"
            className="field__input chat-input"
            disabled={isBusy}
            onChange={(event) => onChatDraftChange(event.target.value)}
            placeholder="Ask anything..."
            type="text"
            value={chatDraft}
          />
          <button
            className="control-button chat-send-button"
            disabled={isBusy || !chatDraft.trim()}
            type="submit"
          >
            {isBusy ? 'Wait' : 'Send'}
          </button>
        </div>
      </form>
    </section>
  );
}

function labelForMessage(message) {
  if (
    message.role === 'assistant' &&
    message.source === 'suggestion_expansion'
  ) {
    return 'assistant from suggestion';
  }

  if (message.role === 'assistant' && message.source === 'typed_answer') {
    return 'assistant';
  }

  if (message.role === 'user' && message.source === 'suggestion_click') {
    return 'user clicked suggestion';
  }

  return message.role;
}
