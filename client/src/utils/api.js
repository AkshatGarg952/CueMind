import {
  buildAudioFileName,
  normalizeAudioMimeType,
} from '@shared/audioFormats.js';

const API_BASE_PATH = resolveApiBasePath(import.meta.env.VITE_API_BASE_URL);
const DEFAULT_REQUEST_TIMEOUT_MS = 65000;

export async function transcribeAudioChunk({
  audioBlob,
  endedAt,
  mimeType,
  settings,
  startedAt,
}) {
  const requestBody = new FormData();
  const normalizedMimeType = normalizeAudioMimeType(mimeType || audioBlob.type);

  requestBody.append(
    'audio',
    new File([audioBlob], buildAudioFileName(endedAt, normalizedMimeType), {
      type: normalizedMimeType,
    }),
  );
  requestBody.append('settings', JSON.stringify(settings));
  requestBody.append('startedAt', startedAt);
  requestBody.append('endedAt', endedAt);

  const response = await fetchWithTimeout(buildApiUrl('/transcribe'), {
    method: 'POST',
    body: requestBody,
  });

  return readApiResponse(response);
}

export async function requestSuggestionRefresh({
  previousSuggestionBatches = [],
  settings,
  transcriptChunks,
}) {
  const response = await fetchWithTimeout(buildApiUrl('/suggestions'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      previousSuggestionBatches,
      settings,
      transcriptChunks,
    }),
  });

  return readApiResponse(response);
}

export async function requestChatReply({
  chatHistory = [],
  focusTranscriptIds = [],
  message = '',
  mode = 'typed',
  settings,
  suggestion = null,
  transcriptChunks = [],
}) {
  const response = await fetchWithTimeout(buildApiUrl('/chat'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      chatHistory,
      focusTranscriptIds,
      message,
      mode,
      settings,
      suggestion,
      transcriptChunks,
    }),
  });

  return readApiResponse(response);
}

async function readApiResponse(response) {
  const payload = await readJsonPayload(response);

  if (!response.ok) {
    throw createApiError(
      payload?.error || 'The request could not be completed.',
      response.status,
    );
  }

  return payload;
}

async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    controller.abort();
  }, DEFAULT_REQUEST_TIMEOUT_MS);

  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal,
    });
  } catch (error) {
    throw normalizeRequestError(error);
  } finally {
    clearTimeout(timeoutId);
  }
}

async function readJsonPayload(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function createApiError(message, statusCode) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function normalizeRequestError(error) {
  if (error?.name === 'AbortError') {
    return createApiError(
      'The request took too long to complete. Check your connection or try again.',
      504,
    );
  }

  if (error instanceof Error && error.message) {
    return createApiError(
      `TwinMind could not reach the server. ${error.message}`,
      503,
    );
  }

  return createApiError(
    'TwinMind could not reach the server. Check the backend URL and try again.',
    503,
  );
}

function buildApiUrl(pathname) {
  return `${API_BASE_PATH}${pathname}`;
}

function resolveApiBasePath(value) {
  const normalizedValue = String(value ?? '').trim();

  if (!normalizedValue) {
    return '/api';
  }

  const withoutTrailingSlashes = normalizedValue.replace(/\/+$/, '');

  if (!/^https?:\/\//i.test(withoutTrailingSlashes)) {
    return withoutTrailingSlashes;
  }

  try {
    const url = new URL(withoutTrailingSlashes);
    const normalizedPathname = url.pathname.replace(/\/+$/, '');

    if (!normalizedPathname) {
      url.pathname = '/api';
    }

    return url.toString().replace(/\/+$/, '');
  } catch {
    return withoutTrailingSlashes;
  }
}
