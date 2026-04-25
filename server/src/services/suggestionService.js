import {
  createSuggestion,
  createSuggestionBatch,
  SUGGESTION_TYPES,
} from '../../../shared/sessionModels.js';
import { mergeSettings } from '../../../shared/defaultSettings.js';
import {
  createGroqApiError,
  createGroqRequestHeaders,
  extractGroqErrorMessage,
} from './groqClient.js';
import {
  analyzeConversationSignals,
  buildLiveSuggestionPrompt,
  createSuggestionPromptContext,
} from './promptBuilders.js';

const GROQ_CHAT_COMPLETIONS_URL = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_SUGGESTIONS_MODEL = 'openai/gpt-oss-120b';
const MAX_GENERATION_ATTEMPTS = 2;
const MAX_TITLE_LENGTH = 80;
const MAX_PREVIEW_LENGTH = 220;
const MAX_REASON_LENGTH = 140;
const MAX_FALLBACK_EXCERPT_LENGTH = 90;
const MAX_HISTORY_BATCHES_CAP = 6;
const TOKEN_OVERLAP_THRESHOLD = 0.72;
const GENERIC_PHRASE_PATTERNS = [
  /ask (a|another) follow[- ]?up question/i,
  /show empathy/i,
  /keep the conversation going/i,
  /summari[sz]e (the|this) discussion/i,
  /respond with confidence/i,
  /offer reassurance/i,
  /clarify the details/i,
  /ask about (the )?(timeline|budget|next steps?)/i,
  /discuss (the )?(timeline|budget|next steps?)/i,
];
const LOW_SIGNAL_WORDS = new Set([
  'a',
  'an',
  'and',
  'are',
  'as',
  'at',
  'be',
  'but',
  'by',
  'for',
  'from',
  'how',
  'if',
  'in',
  'into',
  'is',
  'it',
  'now',
  'of',
  'on',
  'or',
  'the',
  'their',
  'there',
  'this',
  'to',
  'up',
  'use',
  'with',
  'your',
]);

const SUGGESTION_RESPONSE_SCHEMA = {
  name: 'live_suggestion_batch',
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['suggestions'],
    properties: {
      suggestions: {
        type: 'array',
        minItems: 3,
        maxItems: 3,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['type', 'title', 'preview', 'reason'],
          properties: {
            type: {
              type: 'string',
              enum: SUGGESTION_TYPES,
            },
            title: {
              type: 'string',
              minLength: 1,
              maxLength: MAX_TITLE_LENGTH,
            },
            preview: {
              type: 'string',
              minLength: 1,
              maxLength: MAX_PREVIEW_LENGTH,
            },
            reason: {
              type: 'string',
              minLength: 1,
              maxLength: MAX_REASON_LENGTH,
            },
          },
        },
      },
    },
  },
};

export async function generateLiveSuggestionBatch({
  previousSuggestionBatches = [],
  settings,
  transcriptChunks = [],
}) {
  if (transcriptChunks.length === 0) {
    throw createGroqApiError(
      'Record or transcribe at least one transcript chunk before refreshing suggestions.',
      400,
    );
  }

  const promptContext = createSuggestionPromptContext({
    previousSuggestionBatches,
    settings,
    transcriptChunks,
  });
  const selectedTranscriptIds = promptContext.recentTranscriptChunks.map(
    (chunk) => chunk.id,
  );

  let validationFeedback = '';
  let lastCompletion = null;
  let lastError = null;

  for (let attempt = 0; attempt < MAX_GENERATION_ATTEMPTS; attempt += 1) {
    const prompt = buildLiveSuggestionPrompt({
      previousSuggestionBatches,
      settings,
      transcriptChunks,
      validationFeedback,
    });

    try {
      const completion = await requestGroqSuggestionCompletionWithFallback({
        prompt,
        settings,
      });
      lastCompletion = completion;

      const suggestions = validateSuggestionPayload(completion.content, {
        previousSuggestionBatches,
        settings,
        transcriptChunks,
      });

      return {
        batch: createSuggestionBatch({
          basedOnTranscriptIds: selectedTranscriptIds,
          suggestions: suggestions.map((suggestion) => createSuggestion(suggestion)),
        }),
        prompt,
        requestId: completion.requestId,
      };
    } catch (error) {
      lastError = error;
      validationFeedback = error.message;

      if (attempt === MAX_GENERATION_ATTEMPTS - 1) {
        break;
      }
    }
  }

  const resilientSuggestions = buildResilientSuggestionSet({
    completionContent: lastCompletion?.content ?? '',
    previousSuggestionBatches,
    settings,
    transcriptChunks,
  });

  if (resilientSuggestions.length > 0) {
    return {
      batch: createSuggestionBatch({
        basedOnTranscriptIds: selectedTranscriptIds,
        suggestions: resilientSuggestions.map((suggestion) =>
          createSuggestion(suggestion),
        ),
      }),
      prompt: buildLiveSuggestionPrompt({
        previousSuggestionBatches,
        settings,
        transcriptChunks,
        validationFeedback: lastError?.message ?? validationFeedback,
      }),
      requestId: lastCompletion?.requestId ?? null,
    };
  }

  throw lastError || createGroqApiError('Suggestion generation could not be completed.', 502);
}

async function requestGroqSuggestionCompletionWithFallback({ prompt, settings }) {
  try {
    return await requestGroqSuggestionCompletion({
      prompt,
      settings,
      useStructuredOutput: true,
    });
  } catch (error) {
    if (!shouldRetryWithoutStructuredOutput(error)) {
      throw error;
    }

    return requestGroqSuggestionCompletion({
      prompt,
      settings,
      useStructuredOutput: false,
    });
  }
}

async function requestGroqSuggestionCompletion({
  prompt,
  settings,
  useStructuredOutput,
}) {
  const resolvedSettings = mergeSettings(settings);
  const requestBody = {
    model: GROQ_SUGGESTIONS_MODEL,
    temperature: clampTemperature(
      resolvedSettings.modelConfig.suggestionsTemperature,
      0.6,
    ),
    max_completion_tokens: 500,
    messages: [
      {
        role: 'system',
        content: useStructuredOutput
          ? 'You are TwinMind\'s live suggestion decision engine. Infer the meeting mode, live trigger, language style, and best card mix from the provided context, then return only valid JSON that follows the schema.'
          : 'You are TwinMind\'s live suggestion decision engine. Infer the meeting mode, live trigger, language style, and best card mix from the provided context, then return JSON only with no markdown fences or commentary.',
      },
      {
        role: 'user',
        content: prompt,
      },
    ],
  };

  if (useStructuredOutput) {
    requestBody.response_format = {
      type: 'json_schema',
      json_schema: SUGGESTION_RESPONSE_SCHEMA,
    };
  }

  const response = await fetch(GROQ_CHAT_COMPLETIONS_URL, {
    method: 'POST',
    headers: createGroqRequestHeaders(resolvedSettings.groqApiKey),
    body: JSON.stringify(requestBody),
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

function shouldRetryWithoutStructuredOutput(error) {
  const lowerCasedMessage = String(error?.message ?? '').toLowerCase();

  return (
    lowerCasedMessage.includes('failed to validate json') ||
    lowerCasedMessage.includes('failed_generation') ||
    lowerCasedMessage.includes('valid structured suggestion batch')
  );
}

function extractAssistantContent(payload) {
  const content = payload?.choices?.[0]?.message?.content;

  if (typeof content === 'string' && content.trim()) {
    return content;
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
    'Groq returned an empty suggestion response. Please try refreshing again.',
    502,
  );
}

function validateSuggestionPayload(
  content,
  { previousSuggestionBatches = [], settings, transcriptChunks = [] } = {},
) {
  const resolvedSettings = mergeSettings(settings);
  const normalizedSuggestions = normalizeSuggestionPayload(content).map(
    (suggestion, index) => normalizeSuggestion(suggestion, index),
  );

  if (normalizedSuggestions.length !== 3) {
    const resilientSuggestions = buildResilientSuggestionSet({
      completionContent: content,
      previousSuggestionBatches,
      settings,
      transcriptChunks,
    });

    if (resilientSuggestions.length === 3) {
      return resilientSuggestions;
    }

    throw createGroqApiError(
      `Groq returned ${normalizedSuggestions.length} suggestions instead of exactly 3.`,
      502,
    );
  }

  validateInBatchDuplicates(normalizedSuggestions);

  if (resolvedSettings.guardrails.rejectGenericSuggestions) {
    validateGenericSuggestions(normalizedSuggestions);
  }

  validateTypeVariety(normalizedSuggestions, resolvedSettings);

  if (resolvedSettings.guardrails.avoidDuplicateSuggestions) {
    validateAgainstSuggestionHistory(
      normalizedSuggestions,
      previousSuggestionBatches,
      resolvedSettings,
    );
  }

  return normalizedSuggestions;
}

function normalizeSuggestionPayload(content) {
  let parsedPayload;

  try {
    parsedPayload = JSON.parse(extractJsonObjectString(content));
  } catch {
    throw createGroqApiError('Groq returned invalid JSON for the suggestion batch.', 502);
  }

  if (!Array.isArray(parsedPayload?.suggestions)) {
    throw createGroqApiError(
      'Groq returned a suggestion payload without a suggestions array.',
      502,
    );
  }

  return parsedPayload.suggestions;
}

function validateInBatchDuplicates(normalizedSuggestions) {
  const duplicateKeys = new Set();

  normalizedSuggestions.forEach((suggestion, index) => {
    const suggestionKey = `${suggestion.type}:${normalizeComparisonValue(
      suggestion.title,
    )}`;

    if (duplicateKeys.has(suggestionKey)) {
      throw createGroqApiError(
        'Groq returned duplicate suggestion ideas. Refresh again to get a cleaner batch.',
        502,
      );
    }

    duplicateKeys.add(suggestionKey);

    for (let previousIndex = 0; previousIndex < index; previousIndex += 1) {
      if (isNearDuplicateSuggestion(suggestion, normalizedSuggestions[previousIndex])) {
        throw createGroqApiError(
          'Groq returned two suggestions that are too similar to each other. Refresh again for a stronger mix.',
          502,
        );
      }
    }
  });
}

function validateGenericSuggestions(normalizedSuggestions) {
  normalizedSuggestions.forEach((suggestion, index) => {
    const genericIssue = findGenericSuggestionIssue(suggestion);

    if (genericIssue) {
      throw createGroqApiError(
        `Suggestion ${index + 1} was too generic: ${genericIssue}.`,
        502,
      );
    }
  });
}

function validateTypeVariety(normalizedSuggestions, resolvedSettings) {
  const minimumTypeVariety = Math.min(
    normalizedSuggestions.length,
    Math.max(
      2,
      clampPositiveInteger(
        resolvedSettings.guardrails.minimumSuggestionTypeVariety,
        3,
      ),
    ),
  );

  if (
    new Set(normalizedSuggestions.map((suggestion) => suggestion.type)).size <
    minimumTypeVariety
  ) {
    throw createGroqApiError(
      'Groq returned a batch without enough type variety. Refresh again to get a stronger mix.',
      502,
    );
  }
}

function normalizeSuggestion(suggestion, index) {
  if (!suggestion || typeof suggestion !== 'object') {
    throw createGroqApiError(
      `Suggestion ${index + 1} is missing or malformed in the Groq response.`,
      502,
    );
  }

  const type = normalizeSuggestionType(suggestion.type, index);
  const title = normalizeSuggestionText(
    suggestion.title,
    `Suggestion ${index + 1} title`,
    MAX_TITLE_LENGTH,
  );
  const preview = normalizeSuggestionText(
    suggestion.preview,
    `Suggestion ${index + 1} preview`,
    MAX_PREVIEW_LENGTH,
  );
  const reason = normalizeSuggestionText(
    suggestion.reason,
    `Suggestion ${index + 1} reason`,
    MAX_REASON_LENGTH,
  );

  return {
    preview,
    reason,
    title,
    type,
  };
}

function normalizeSuggestionType(value, index) {
  const normalizedValue = normalizeComparisonValue(value);

  if (!SUGGESTION_TYPES.includes(normalizedValue)) {
    throw createGroqApiError(
      `Suggestion ${index + 1} used an unsupported type: ${value}.`,
      502,
    );
  }

  return normalizedValue;
}

function normalizeSuggestionText(value, label, maxLength) {
  const normalizedValue = String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim();

  if (!normalizedValue) {
    throw createGroqApiError(`${label} was empty in the Groq response.`, 502);
  }

  return truncateText(normalizedValue, maxLength);
}

function normalizeInlineText(value) {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim();
}

function truncateText(value, maxLength) {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`;
}

function normalizeComparisonValue(value) {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function validateAgainstSuggestionHistory(
  normalizedSuggestions,
  previousSuggestionBatches,
  resolvedSettings,
) {
  const historyBatches = Math.min(
    MAX_HISTORY_BATCHES_CAP,
    clampPositiveInteger(
      resolvedSettings.guardrails.suggestionHistoryBatches,
      3,
    ),
  );
  const recentSuggestions = previousSuggestionBatches
    .filter((batch) => Array.isArray(batch?.suggestions))
    .slice(0, historyBatches)
    .flatMap((batch) => batch.suggestions)
    .map((suggestion) => ({
      preview: String(suggestion?.preview ?? ''),
      title: String(suggestion?.title ?? ''),
      type: String(suggestion?.type ?? ''),
    }));

  normalizedSuggestions.forEach((suggestion) => {
    const repeatedSuggestion = recentSuggestions.find((recentSuggestion) =>
      isNearDuplicateSuggestion(suggestion, recentSuggestion),
    );

    if (repeatedSuggestion) {
      throw createGroqApiError(
        `Groq repeated a recent suggestion idea ("${repeatedSuggestion.title || 'untitled suggestion'}"). Refresh again for a fresher batch.`,
        502,
      );
    }
  });
}

function findGenericSuggestionIssue(suggestion) {
  const title = suggestion.title;
  const preview = suggestion.preview;
  const combinedText = `${title} ${preview}`.trim();

  if (GENERIC_PHRASE_PATTERNS.some((pattern) => pattern.test(combinedText))) {
    return 'the title or preview used a generic coaching phrase';
  }

  if (getMeaningfulTokens(title).length < 2) {
    return 'the title was too vague';
  }

  if (getMeaningfulTokens(preview).length < 5) {
    return 'the preview did not contain enough concrete detail';
  }

  return '';
}

function isNearDuplicateSuggestion(firstSuggestion, secondSuggestion) {
  const normalizedFirstTitle = normalizeComparisonValue(firstSuggestion?.title);
  const normalizedSecondTitle = normalizeComparisonValue(secondSuggestion?.title);
  const normalizedFirstPreview = normalizeComparisonValue(firstSuggestion?.preview);
  const normalizedSecondPreview = normalizeComparisonValue(secondSuggestion?.preview);

  if (!normalizedFirstTitle || !normalizedSecondTitle) {
    return false;
  }

  if (normalizedFirstTitle === normalizedSecondTitle) {
    return true;
  }

  if (
    normalizedFirstPreview &&
    normalizedSecondPreview &&
    normalizedFirstPreview === normalizedSecondPreview
  ) {
    return true;
  }

  const titleOverlap = calculateTokenOverlap(
    getMeaningfulTokens(firstSuggestion?.title),
    getMeaningfulTokens(secondSuggestion?.title),
  );
  const previewOverlap = calculateTokenOverlap(
    getMeaningfulTokens(firstSuggestion?.preview),
    getMeaningfulTokens(secondSuggestion?.preview),
  );

  return (
    titleOverlap >= TOKEN_OVERLAP_THRESHOLD ||
    (titleOverlap >= 0.5 && previewOverlap >= TOKEN_OVERLAP_THRESHOLD)
  );
}

function getMeaningfulTokens(value) {
  return normalizeComparisonValue(value)
    .split(/[^a-z0-9]+/i)
    .filter(
      (token) => token.length >= 3 && !LOW_SIGNAL_WORDS.has(token),
    );
}

function calculateTokenOverlap(firstTokens, secondTokens) {
  const firstSet = new Set(firstTokens);
  const secondSet = new Set(secondTokens);

  if (firstSet.size === 0 || secondSet.size === 0) {
    return 0;
  }

  let overlapCount = 0;

  firstSet.forEach((token) => {
    if (secondSet.has(token)) {
      overlapCount += 1;
    }
  });

  return overlapCount / Math.max(firstSet.size, secondSet.size);
}

function clampTemperature(value, fallback) {
  const parsedValue = Number(value);

  if (!Number.isFinite(parsedValue)) {
    return fallback;
  }

  return Math.min(1, Math.max(0, parsedValue));
}

function clampPositiveInteger(value, fallback) {
  const parsedValue = Number(value);

  if (!Number.isInteger(parsedValue) || parsedValue <= 0) {
    return fallback;
  }

  return parsedValue;
}

async function readJsonPayload(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function buildResilientSuggestionSet({
  completionContent,
  previousSuggestionBatches = [],
  settings,
  transcriptChunks = [],
}) {
  const resolvedSettings = mergeSettings(settings);
  const salvagedSuggestions = salvageSuggestionsFromCompletion(completionContent);
  const fallbackSuggestions = createTranscriptFallbackSuggestions({
    previousSuggestionBatches,
    transcriptChunks,
  });
  const mergedSuggestions = [];

  salvagedSuggestions.forEach((suggestion) => {
    pushIfDistinct(mergedSuggestions, suggestion);
  });

  fallbackSuggestions.forEach((suggestion) => {
    if (mergedSuggestions.length < 3) {
      pushIfDistinct(mergedSuggestions, suggestion);
    }
  });

  const finalizedSuggestions = mergedSuggestions.slice(0, 3);

  if (finalizedSuggestions.length !== 3) {
    return [];
  }

  try {
    validateInBatchDuplicates(finalizedSuggestions);

    if (resolvedSettings.guardrails.rejectGenericSuggestions) {
      validateGenericSuggestions(finalizedSuggestions);
    }

    if (resolvedSettings.guardrails.avoidDuplicateSuggestions) {
      validateAgainstSuggestionHistory(
        finalizedSuggestions,
        previousSuggestionBatches,
        resolvedSettings,
      );
    }

    return enforceSuggestionTypeVariety(finalizedSuggestions, transcriptChunks);
  } catch {
    return createTranscriptFallbackSuggestions({
      previousSuggestionBatches,
      transcriptChunks,
    }).slice(0, 3);
  }
}

function salvageSuggestionsFromCompletion(content) {
  try {
    return normalizeSuggestionPayload(content)
      .map((suggestion, index) => {
        try {
          return normalizeSuggestion(suggestion, index);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

function createTranscriptFallbackSuggestions({
  previousSuggestionBatches = [],
  transcriptChunks = [],
}) {
  const recentTranscriptChunks = transcriptChunks.slice(-3);
  const latestTranscriptChunk = transcriptChunks.at(-1);
  const latestText = normalizeInlineText(
    latestTranscriptChunk?.text || recentTranscriptChunks.at(-1)?.text,
  );
  const latestExcerpt = truncateText(
    latestText || 'the latest part of the conversation',
    MAX_FALLBACK_EXCERPT_LENGTH,
  );
  const recentContext = truncateText(
    recentTranscriptChunks
      .map((chunk) => normalizeInlineText(chunk?.text))
      .filter(Boolean)
      .join(' '),
    220,
  );
  const conversationSignals = analyzeConversationSignals({
    recentTranscriptChunks,
    transcriptChunks,
  });
  const primaryTrigger = conversationSignals.triggerEvents.at(0);
  const isMixedLanguage =
    conversationSignals.languageStyle.label ===
    'Hinglish or mixed Hindi-English';
  const transcriptHasConcreteClaim = /\b\d+[%]?\b|\b(deadline|launch|launched|revenue|budget|cost|timeline|metric|kpi|customers?|users?|founded|intern|b\.tech|electronics|communication)\b/i.test(
    recentContext,
  );
  const transcriptHasAmbiguity = /\b(maybe|probably|i think|not sure|kind of|around|roughly|currently|planning|plan|might)\b/i.test(
    recentContext,
  );
  const transcriptHasRiskSignal = /\b(risk|blocker|blocked|dependency|fallback|rollback|failure|crash|latency|security|privacy|monitoring|alert|issue)\b/i.test(
    recentContext,
  );
  const usedTitles = new Set(
    previousSuggestionBatches
      .flatMap((batch) => batch?.suggestions ?? [])
      .map((suggestion) => normalizeComparisonValue(suggestion?.title)),
  );
  const reasonPrefix = primaryTrigger
    ? `${capitalizeText(primaryTrigger.label)} detected`
    : `${capitalizeText(conversationSignals.mode.label)} mode`;
  const askLead = isMixedLanguage ? 'Clarify kar lo' : 'Ask';
  const sayLead = isMixedLanguage ? 'Say simply' : 'Say';
  const candidatesByType = {
    answer: {
      type: 'answer',
      title: chooseUniqueTitle('Answer from the latest constraint', usedTitles),
      preview: `${sayLead}: "Based on the latest point, ${latestExcerpt}" and avoid adding any claim the transcript has not supported.`,
      reason: primaryTrigger?.id === 'question_asked'
        ? 'Recent question detected'
        : reasonPrefix,
    },
    clarify: {
      type: 'clarify',
      title: chooseUniqueTitle('Pin down the uncertain detail', usedTitles),
      preview: `${askLead} what "${latestExcerpt}" specifically means: scope, example, owner, or timeframe.`,
      reason: transcriptHasAmbiguity
        ? 'Uncertainty detected'
        : reasonPrefix,
    },
    next_step: {
      type: 'next_step',
      title: chooseUniqueTitle('Lock owner deadline and success check', usedTitles),
      preview: `${askLead}: "Who owns the next step from this, what is the deadline, and how will we know it is done?"`,
      reason: /deadline|timeline|action|decision|owner/i.test(reasonPrefix)
        ? reasonPrefix
        : 'Next step opportunity',
    },
    question: {
      type: 'question',
      title: chooseUniqueTitle('Ask the highest leverage follow-up', usedTitles),
      preview: `${askLead}: "What is the one detail in '${latestExcerpt}' that must be confirmed before we move forward?"`,
      reason: reasonPrefix,
    },
    risk: {
      type: 'risk',
      title: chooseUniqueTitle('Flag the missing safety check', usedTitles),
      preview: `Risk to raise: "${latestExcerpt}" still needs a fallback, dependency, owner, monitoring, or rollback check before it is treated as settled.`,
      reason: transcriptHasRiskSignal ? 'Possible risk detected' : reasonPrefix,
    },
    talking_point: {
      type: 'talking_point',
      title: chooseUniqueTitle('Use the strongest current point', usedTitles),
      preview: `${sayLead}: "The strongest point so far is ${latestExcerpt}; the useful move now is to connect it to the immediate decision."`,
      reason: reasonPrefix,
    },
  };

  if (transcriptHasConcreteClaim) {
    candidatesByType.fact_check = {
      type: 'fact_check',
      title: chooseUniqueTitle('Verify the concrete claim', usedTitles),
      preview: `Before repeating "${latestExcerpt}", verify the number, source, timeline, or technical constraint that makes the claim reliable.`,
      reason: 'Concrete claim detected',
    };
  }

  const preferredTypes = [
    ...conversationSignals.suggestedMix,
    'answer',
    'question',
    'risk',
    'next_step',
    'clarify',
    'talking_point',
    'fact_check',
  ];
  const candidates = [];

  preferredTypes.forEach((type) => {
    const candidate = candidatesByType[type];

    if (!candidate || candidates.length >= 3) {
      return;
    }

    pushIfDistinct(candidates, candidate);
  });

  return candidates
    .slice(0, 3)
    .map((suggestion, index) => normalizeSuggestion(suggestion, index));
}

function enforceSuggestionTypeVariety(suggestions, transcriptChunks = []) {
  const currentTypes = new Set(suggestions.map((suggestion) => suggestion.type));

  if (currentTypes.size >= 3) {
    return suggestions.slice(0, 3);
  }

  const supplementalSuggestions = createTranscriptFallbackSuggestions({
    previousSuggestionBatches: [],
    transcriptChunks,
  });
  const uniqueTypeSuggestions = [];
  const seenTypes = new Set();

  suggestions.forEach((suggestion) => {
    if (seenTypes.has(suggestion.type)) {
      return;
    }

    uniqueTypeSuggestions.push(suggestion);
    seenTypes.add(suggestion.type);
  });

  supplementalSuggestions.forEach((suggestion) => {
    if (
      uniqueTypeSuggestions.length >= 3 ||
      seenTypes.has(suggestion.type) ||
      uniqueTypeSuggestions.some((candidate) =>
        isNearDuplicateSuggestion(candidate, suggestion),
      )
    ) {
      return;
    }

    uniqueTypeSuggestions.push(suggestion);
    seenTypes.add(suggestion.type);
  });

  suggestions.forEach((suggestion) => {
    if (
      uniqueTypeSuggestions.length >= 3 ||
      uniqueTypeSuggestions.some((candidate) =>
        isNearDuplicateSuggestion(candidate, suggestion),
      )
    ) {
      return;
    }

    uniqueTypeSuggestions.push(suggestion);
  });

  return uniqueTypeSuggestions.slice(0, 3);
}

function pushIfDistinct(collection, suggestion) {
  if (
    collection.some(
      (candidate) =>
        candidate.type === suggestion.type ||
        isNearDuplicateSuggestion(candidate, suggestion),
    )
  ) {
    return;
  }

  collection.push(suggestion);
}

function capitalizeText(value) {
  const normalizedValue = normalizeInlineText(value);

  return normalizedValue
    ? `${normalizedValue.charAt(0).toUpperCase()}${normalizedValue.slice(1)}`
    : '';
}

function chooseUniqueTitle(baseTitle, usedTitles) {
  const normalizedBaseTitle = normalizeComparisonValue(baseTitle);

  if (!usedTitles.has(normalizedBaseTitle)) {
    usedTitles.add(normalizedBaseTitle);
    return baseTitle;
  }

  let suffix = 2;

  while (usedTitles.has(normalizeComparisonValue(`${baseTitle} ${suffix}`))) {
    suffix += 1;
  }

  const uniqueTitle = `${baseTitle} ${suffix}`;
  usedTitles.add(normalizeComparisonValue(uniqueTitle));
  return uniqueTitle;
}

function extractJsonObjectString(content) {
  const normalizedContent = String(content ?? '').trim();

  if (!normalizedContent) {
    return normalizedContent;
  }

  const fencedMatch = normalizedContent.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);

  if (fencedMatch?.[1]) {
    return fencedMatch[1].trim();
  }

  const firstBraceIndex = normalizedContent.indexOf('{');
  const lastBraceIndex = normalizedContent.lastIndexOf('}');

  if (firstBraceIndex >= 0 && lastBraceIndex > firstBraceIndex) {
    return normalizedContent.slice(firstBraceIndex, lastBraceIndex + 1);
  }

  return normalizedContent;
}
