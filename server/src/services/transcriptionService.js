import {
  createGroqApiError,
  ensureGroqApiKey,
  extractGroqErrorMessage,
} from './groqClient.js';
import { normalizeAudioMimeType } from '../../../shared/audioFormats.js';

const GROQ_TRANSCRIPTION_URL = 'https://api.groq.com/openai/v1/audio/transcriptions';
const GROQ_TRANSCRIPTION_MODEL = 'whisper-large-v3';

export async function transcribeAudioChunk({
  apiKey,
  audioBuffer,
  fileName,
  mimeType,
}) {
  ensureGroqApiKey(apiKey);
  const normalizedMimeType = normalizeAudioMimeType(mimeType);

  const requestBody = new FormData();
  requestBody.append(
    'file',
    new Blob([audioBuffer], {
      type: normalizedMimeType,
    }),
    fileName,
  );
  requestBody.append('model', GROQ_TRANSCRIPTION_MODEL);
  requestBody.append('response_format', 'json');
  requestBody.append('temperature', '0');

  const groqResponse = await fetch(GROQ_TRANSCRIPTION_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
    body: requestBody,
  });

  const payload = await readJsonPayload(groqResponse);

  if (!groqResponse.ok) {
    throw createGroqApiError(
      extractGroqErrorMessage(payload),
      groqResponse.status >= 400 && groqResponse.status < 500
        ? groqResponse.status
        : 502,
    );
  }

  return {
    requestId: payload?.x_groq?.id ?? null,
    text: typeof payload?.text === 'string' ? payload.text.trim() : '',
  };
}

async function readJsonPayload(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}
