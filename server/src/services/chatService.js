import { createChatMessage } from '../../../shared/sessionModels.js';
import { mergeSettings } from '../../../shared/defaultSettings.js';
import {
  createGroqApiError,
  createGroqRequestHeaders,
  extractGroqErrorMessage,
} from './groqClient.js';
import {
  buildChatPrompt,
  buildDetailedAnswerPrompt,
} from './promptBuilders.js';

const GROQ_CHAT_COMPLETIONS_URL =
  'https://api.groq.com/openai/v1/chat/completions';
const GROQ_CHAT_MODEL = 'openai/gpt-oss-120b';
const SUPPORTED_CHAT_MODES = ['suggestion_click', 'typed'];

export async function generateChatReply({
  chatHistory = [],
  focusTranscriptIds = [],
  message = '',
  mode = 'typed',
  settings,
  suggestion = null,
  transcriptChunks = [],
}) {
  const normalizedMode = normalizeMode(mode);
  const normalizedMessage = normalizeInlineText(message);
  const prompt = buildPrompt({
    chatHistory,
    focusTranscriptIds,
    message: normalizedMessage,
    mode: normalizedMode,
    settings,
    suggestion,
    transcriptChunks,
  });
  const completion = await requestGroqChatCompletion({
    prompt,
    settings,
  });

  return {
    assistantMessage: createChatMessage({
      role: 'assistant',
      source:
        normalizedMode === 'suggestion_click'
          ? 'suggestion_expansion'
          : 'typed_answer',
      text: sanitizeAssistantText(completion.content),
      linkedSuggestionId: suggestion?.id ?? null,
    }),
    prompt,
    requestId: completion.requestId,
  };
}

function buildPrompt({
  chatHistory,
  focusTranscriptIds,
  message,
  mode,
  settings,
  suggestion,
  transcriptChunks,
}) {
  if (mode === 'suggestion_click') {
    if (!suggestion || typeof suggestion !== 'object') {
      throw createGroqApiError(
        'A clicked suggestion payload is required before generating an expanded answer.',
        400,
      );
    }

    return buildDetailedAnswerPrompt({
      chatHistory,
      focusTranscriptIds,
      settings,
      suggestion,
      transcriptChunks,
    });
  }

  if (!message) {
    throw createGroqApiError(
      'Type a question before requesting a chat reply.',
      400,
    );
  }

  return buildChatPrompt({
    chatHistory,
    message,
    settings,
    transcriptChunks,
  });
}

function normalizeMode(mode) {
  if (SUPPORTED_CHAT_MODES.includes(mode)) {
    return mode;
  }

  throw createGroqApiError(`Unsupported chat mode: ${mode}.`, 400);
}

async function requestGroqChatCompletion({ prompt, settings }) {
  const resolvedSettings = mergeSettings(settings);
  const response = await fetch(GROQ_CHAT_COMPLETIONS_URL, {
    method: 'POST',
    headers: createGroqRequestHeaders(resolvedSettings.groqApiKey),
    body: JSON.stringify({
      model: GROQ_CHAT_MODEL,
      temperature: clampTemperature(
        resolvedSettings.modelConfig.chatTemperature,
        0.4,
      ),
      max_completion_tokens: 550,
      messages: [
        {
          role: 'system',
          content:
            "You are TwinMind's live answer engine. Use the clicked suggestion, transcript, chat history, meeting-mode signals, and language style to give a concise, grounded response. Never invent unsupported facts, and return plain text only.",
        },
        {
          role: 'user',
          content: prompt,
        },
      ],
    }),
  });

  const payload = await readJsonPayload(response);

  if (!response.ok) {
    throw createGroqApiError(
      extractGroqErrorMessage(payload),
      response.status >= 400 && response.status < 500 ? response.status : 502,
    );
  }

  return {
    content: extractAssistantContent(payload),
    requestId: payload?.x_groq?.id ?? null,
  };
}

function extractAssistantContent(payload) {
  const content = payload?.choices?.[0]?.message?.content;

  if (typeof content === 'string' && content.trim()) {
    return content.trim();
  }

  if (Array.isArray(content)) {
    const joinedContent = content
      .map((part) => (typeof part?.text === 'string' ? part.text : ''))
      .join('')
      .trim();

    if (joinedContent) {
      return joinedContent;
    }
  }

  throw createGroqApiError(
    'Groq returned an empty chat response. Please retry the request.',
    502,
  );
}

function clampTemperature(value, fallback) {
  const parsedValue = Number(value);

  if (!Number.isFinite(parsedValue)) {
    return fallback;
  }

  return Math.min(1, Math.max(0, parsedValue));
}

function normalizeInlineText(value) {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim();
}

function sanitizeAssistantText(value) {
  return String(value ?? '')
    .replace(/\*\*(.*?)\*\*/gs, '$1')
    .replace(/__(.*?)__/gs, '$1')
    .replace(/\*\*/g, '')
    .replace(/__/g, '')
    .trim();
}

async function readJsonPayload(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}
