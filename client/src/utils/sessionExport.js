function formatTimestamp(value) {
  return new Date(value).toLocaleString([], {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

function buildSafeTimestamp(value = new Date()) {
  return new Date(value).toISOString().replaceAll(':', '-');
}

function sanitizeSettings(settings = {}) {
  const safeSettings = { ...settings };

  delete safeSettings.groqApiKey;

  return safeSettings;
}

function countSuggestions(suggestionBatches = []) {
  return suggestionBatches.reduce(
    (total, batch) =>
      total +
      (Array.isArray(batch?.suggestions) ? batch.suggestions.length : 0),
    0,
  );
}

function buildSessionStartedAt(sessionState) {
  return (
    sessionState.transcriptChunks[0]?.startedAt ||
    sessionState.suggestionBatches.at(-1)?.createdAt ||
    sessionState.chatMessages[0]?.createdAt ||
    null
  );
}

export function buildSessionExportPayload({ sessionState, settings }) {
  const sessionStartedAt = buildSessionStartedAt(sessionState);

  return {
    app: 'TwinMind',
    exportVersion: 1,
    exportedAt: new Date().toISOString(),
    sessionStartedAt,
    summary: {
      transcriptChunkCount: sessionState.transcriptChunks.length,
      suggestionBatchCount: sessionState.suggestionBatches.length,
      suggestionCount: countSuggestions(sessionState.suggestionBatches),
      chatMessageCount: sessionState.chatMessages.length,
    },
    settings: sanitizeSettings(settings),
    session: {
      transcriptChunks: sessionState.transcriptChunks,
      suggestionBatches: sessionState.suggestionBatches,
      chatMessages: sessionState.chatMessages,
    },
  };
}

export function exportSessionAsJson({ sessionState, settings }) {
  const payload = buildSessionExportPayload({
    sessionState,
    settings,
  });

  downloadTextFile({
    content: `${JSON.stringify(payload, null, 2)}\n`,
    fileName: `twinmind-session-${buildSafeTimestamp()}.json`,
    mimeType: 'application/json',
  });
}

export function exportSessionAsText({ sessionState, settings }) {
  const payload = buildSessionExportPayload({
    sessionState,
    settings,
  });
  const transcriptSection =
    payload.session.transcriptChunks.length === 0
      ? 'No transcript chunks captured.'
      : payload.session.transcriptChunks
          .map(
            (chunk, index) =>
              `${index + 1}. ${formatTimestamp(chunk.startedAt)} -> ${formatTimestamp(
                chunk.endedAt,
              )}\n${chunk.text}`,
          )
          .join('\n\n');
  const suggestionSection =
    payload.session.suggestionBatches.length === 0
      ? 'No suggestion batches generated.'
      : payload.session.suggestionBatches
          .map((batch, batchIndex) => {
            const suggestionLines =
              batch.suggestions?.length > 0
                ? batch.suggestions
                    .map(
                      (suggestion, suggestionIndex) =>
                        `${suggestionIndex + 1}. [${suggestion.type}] ${suggestion.title}\nPreview: ${suggestion.preview}\nReason: ${suggestion.reason}`,
                    )
                    .join('\n')
                : 'No suggestions in this batch.';

            return `Batch ${batchIndex + 1} - ${formatTimestamp(batch.createdAt)}\n${suggestionLines}`;
          })
          .join('\n\n');
  const chatSection =
    payload.session.chatMessages.length === 0
      ? 'No chat messages yet.'
      : payload.session.chatMessages
          .map(
            (message, index) =>
              `${index + 1}. ${formatTimestamp(message.createdAt)} [${message.role}/${message.source}]\n${message.text}`,
          )
          .join('\n\n');
  const lines = [
    'TwinMind Session Export',
    `Exported: ${formatTimestamp(payload.exportedAt)}`,
    `Session started: ${payload.sessionStartedAt ? formatTimestamp(payload.sessionStartedAt) : 'Unknown'}`,
    '',
    'Summary',
    `- Transcript chunks: ${payload.summary.transcriptChunkCount}`,
    `- Suggestion batches: ${payload.summary.suggestionBatchCount}`,
    `- Suggestions: ${payload.summary.suggestionCount}`,
    `- Chat messages: ${payload.summary.chatMessageCount}`,
    '',
    'Transcript',
    transcriptSection,
    '',
    'Suggestions',
    suggestionSection,
    '',
    'Chat',
    chatSection,
  ];

  downloadTextFile({
    content: `${lines.join('\n')}\n`,
    fileName: `twinmind-session-${buildSafeTimestamp()}.txt`,
    mimeType: 'text/plain;charset=utf-8',
  });
}

function downloadTextFile({ content, fileName, mimeType }) {
  const blob = new Blob([content], {
    type: mimeType,
  });
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement('a');

  anchor.href = objectUrl;
  anchor.download = fileName;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(objectUrl);
}
