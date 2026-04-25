export const RECORDING_STATES = ['idle', 'recording', 'processing', 'error'];
export const SESSION_STORAGE_KEY = 'twin-mind-session';

export const SUGGESTION_TYPES = [
  'question',
  'talking_point',
  'answer',
  'fact_check',
  'clarify',
  'risk',
  'next_step',
];

function fallbackId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function createEntityId(prefix) {
  const id =
    typeof globalThis.crypto !== 'undefined' &&
    typeof globalThis.crypto.randomUUID === 'function'
      ? globalThis.crypto.randomUUID()
      : fallbackId();

  return `${prefix}_${id}`;
}

export function createTimestamp(value = new Date()) {
  const resolvedDate = new Date(value);

  if (Number.isNaN(resolvedDate.getTime())) {
    return new Date().toISOString();
  }

  return resolvedDate.toISOString();
}

export function createTranscriptChunk({
  id = createEntityId('tx'),
  text = '',
  startedAt = createTimestamp(),
  endedAt = startedAt,
  createdAt = endedAt,
  source = 'mic',
} = {}) {
  return {
    id,
    text: String(text ?? '').trim(),
    startedAt: createTimestamp(startedAt),
    endedAt: createTimestamp(endedAt),
    createdAt: createTimestamp(createdAt),
    source,
  };
}

export function createSuggestion({
  id = createEntityId('sg'),
  batchId = '',
  type = 'question',
  title = '',
  preview = '',
  reason = '',
  createdAt = createTimestamp(),
} = {}) {
  return {
    id,
    batchId,
    type,
    title: String(title ?? '').trim(),
    preview: String(preview ?? '').trim(),
    reason: String(reason ?? '').trim(),
    createdAt: createTimestamp(createdAt),
  };
}

export function createSuggestionBatch({
  id = createEntityId('sb'),
  createdAt = createTimestamp(),
  basedOnTranscriptIds = [],
  suggestions = [],
} = {}) {
  return {
    id,
    createdAt: createTimestamp(createdAt),
    basedOnTranscriptIds: Array.isArray(basedOnTranscriptIds)
      ? basedOnTranscriptIds.filter(Boolean)
      : [],
    suggestions: Array.isArray(suggestions)
      ? suggestions.map((suggestion) =>
          createSuggestion({
            ...suggestion,
            batchId: suggestion?.batchId || id,
          }),
        )
      : [],
  };
}

export function createChatMessage({
  id = createEntityId('cm'),
  role = 'assistant',
  source = 'generated_answer',
  text = '',
  linkedSuggestionId = null,
  createdAt = createTimestamp(),
} = {}) {
  return {
    id,
    role,
    source,
    text: String(text ?? '').trim(),
    linkedSuggestionId,
    createdAt: createTimestamp(createdAt),
  };
}

export function createSessionState({
  transcriptChunks = [],
  suggestionBatches = [],
  chatMessages = [],
} = {}) {
  return {
    transcriptChunks: Array.isArray(transcriptChunks)
      ? transcriptChunks.map((transcriptChunk) =>
          createTranscriptChunk(transcriptChunk),
        )
      : [],
    suggestionBatches: Array.isArray(suggestionBatches)
      ? suggestionBatches.map((suggestionBatch) =>
          createSuggestionBatch(suggestionBatch),
        )
      : [],
    chatMessages: Array.isArray(chatMessages)
      ? chatMessages.map((chatMessage) => createChatMessage(chatMessage))
      : [],
  };
}
