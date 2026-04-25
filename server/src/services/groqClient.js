export function ensureGroqApiKey(apiKey) {
  if (!apiKey) {
    const error = new Error('A Groq API key is required in settings before calling AI routes.');
    error.statusCode = 400;
    throw error;
  }
}

export function createGroqRequestHeaders(apiKey) {
  ensureGroqApiKey(apiKey);

  return {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  };
}

export function createGroqApiError(message, statusCode = 502) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

export function extractGroqErrorMessage(payload) {
  if (!payload) {
    return 'Groq could not process the request.';
  }

  if (typeof payload.error === 'string' && payload.error.trim()) {
    return normalizeGroqErrorMessage(payload.error);
  }

  if (
    payload.error &&
    typeof payload.error.message === 'string' &&
    payload.error.message.trim()
  ) {
    return normalizeGroqErrorMessage(payload.error.message);
  }

  return 'Groq could not process the request.';
}

function normalizeGroqErrorMessage(message) {
  const trimmedMessage = message.trim();
  const lowerCasedMessage = trimmedMessage.toLowerCase();

  if (
    lowerCasedMessage.includes('could not process file') ||
    lowerCasedMessage.includes('valid media file')
  ) {
    return 'Groq could not read the latest audio chunk. TwinMind now keeps chunks shorter, so restart the microphone and try again.';
  }

  if (
    lowerCasedMessage.includes('failed to validate json') ||
    lowerCasedMessage.includes('failed_generation')
  ) {
    return 'Groq could not produce a valid structured suggestion batch on that attempt. TwinMind will retry with a looser JSON prompt.';
  }

  return trimmedMessage;
}
