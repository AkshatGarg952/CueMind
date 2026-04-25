import { mergeSettings } from '../../../shared/defaultSettings.js';

const MAX_DIGEST_CHUNKS = 3;
const MAX_DIGEST_TEXT_LENGTH = 220;
const MAX_HISTORY_BATCHES_CAP = 6;
const MAX_CHAT_HISTORY_MESSAGES = 8;
const MAX_FOCUSED_TRANSCRIPT_CHUNKS = 6;
const MAX_SIGNAL_EVIDENCE_LENGTH = 140;
const MAX_TRIGGER_EVENTS = 5;

const CONTEXT_STOP_WORDS = new Set([
  'about',
  'after',
  'again',
  'also',
  'and',
  'are',
  'because',
  'but',
  'can',
  'could',
  'from',
  'have',
  'into',
  'just',
  'like',
  'need',
  'now',
  'our',
  'should',
  'that',
  'the',
  'their',
  'then',
  'there',
  'they',
  'this',
  'was',
  'what',
  'when',
  'where',
  'which',
  'with',
  'would',
  'you',
]);

const MODE_RULES = [
  {
    id: 'interview',
    label: 'interview',
    preferredMix: ['answer', 'question', 'talking_point'],
    patterns: [
      /\b(candidate|resume|experience|interview|hiring|role|strength|weakness|notice period|joining|salary|tell me about)\b/i,
    ],
  },
  {
    id: 'sales_call',
    label: 'sales call',
    preferredMix: ['answer', 'question', 'risk'],
    patterns: [
      /\b(pricing|budget|demo|proposal|contract|customer|client|objection|roi|renewal|stakeholder|deal|pilot|procurement)\b/i,
    ],
  },
  {
    id: 'standup',
    label: 'standup or progress update',
    preferredMix: ['next_step', 'clarify', 'risk'],
    patterns: [
      /\b(standup|daily update|yesterday|today|blocker|blocked|working on|progress|eta|status update)\b/i,
    ],
  },
  {
    id: 'bug_triage',
    label: 'bug triage or incident review',
    preferredMix: ['clarify', 'fact_check', 'next_step'],
    patterns: [
      /\b(bug|issue|error|crash|incident|repro|steps to reproduce|root cause|hotfix|rollback|stack trace|severity)\b/i,
    ],
  },
  {
    id: 'planning',
    label: 'planning or launch discussion',
    preferredMix: ['question', 'next_step', 'risk'],
    patterns: [
      /\b(plan|roadmap|timeline|deadline|milestone|owner|dependency|scope|prioriti[sz]e|release|launch|sprint|qa signoff)\b/i,
    ],
  },
  {
    id: 'brainstorming',
    label: 'brainstorming',
    preferredMix: ['talking_point', 'question', 'risk'],
    patterns: [
      /\b(idea|brainstorm|what if|could we|option|approach|experiment|hypothesis|creative|alternative)\b/i,
    ],
  },
  {
    id: 'technical_debugging',
    label: 'technical debugging',
    preferredMix: ['answer', 'clarify', 'risk'],
    patterns: [
      /\b(api|database|redis|render|deployment|server|client|latency|cache|endpoint|docker|kubernetes|frontend|backend|integration|private network)\b/i,
    ],
  },
  {
    id: 'learning',
    label: 'learning or coaching',
    preferredMix: ['answer', 'clarify', 'next_step'],
    patterns: [
      /\b(explain|understand|assignment|class|project|learn|mentor|feedback|review|improve|rubric)\b/i,
    ],
  },
];

const TRIGGER_RULES = [
  {
    id: 'question_asked',
    label: 'recent question',
    preferredTypes: ['answer', 'clarify'],
    priority: 1,
    patterns: [
      /\?/,
      /\b(can you|could you|what|why|how|when|where|which|should we|do we|does it|is there|are we)\b/i,
    ],
  },
  {
    id: 'decision_point',
    label: 'decision point',
    preferredTypes: ['question', 'next_step'],
    priority: 2,
    patterns: [
      /\b(decide|decision|choose|final|approve|sign off|signoff|go with|confirm|lock|greenlight|settle on)\b/i,
    ],
  },
  {
    id: 'deadline_or_timeline',
    label: 'deadline or timeline',
    preferredTypes: ['next_step', 'risk'],
    priority: 3,
    patterns: [
      /\b(today|tomorrow|eod|deadline|due|eta|timeline|next week|this week|by monday|by tuesday|by wednesday|by thursday|by friday|aaj|kal)\b/i,
    ],
  },
  {
    id: 'action_item',
    label: 'action item',
    preferredTypes: ['next_step', 'clarify'],
    priority: 4,
    patterns: [
      /\b(i will|we will|let's|next step|action item|owner|assign|follow up|send|share|create|ship|fix|deploy|handoff)\b/i,
    ],
  },
  {
    id: 'risk_or_blocker',
    label: 'risk or blocker',
    preferredTypes: ['risk', 'question'],
    priority: 5,
    patterns: [
      /\b(risk|blocker|blocked|dependency|fallback|rollback|outage|failure|crash|latency|security|privacy|compliance|monitoring|alert|edge case)\b/i,
    ],
  },
  {
    id: 'disagreement',
    label: 'disagreement or tension',
    preferredTypes: ['clarify', 'question'],
    priority: 6,
    patterns: [
      /\b(i disagree|not sure about that|concern|doesn't work|cannot work|can't work|issue with|rather than|instead of|however)\b/i,
    ],
  },
  {
    id: 'budget_or_pricing',
    label: 'budget or pricing',
    preferredTypes: ['fact_check', 'question'],
    priority: 7,
    patterns: [
      /\b(budget|cost|pricing|price|revenue|spend|roi|lakhs?|crores?|inr|rs\.?|dollars?)\b|[$]/i,
    ],
  },
  {
    id: 'metric_or_claim',
    label: 'metric or concrete claim',
    preferredTypes: ['fact_check', 'answer'],
    priority: 8,
    patterns: [
      /\b\d+(\.\d+)?\s?(%|percent|k|m|ms|sec|seconds|users|customers|requests|rupees|dollars)\b/i,
      /\b(metric|kpi|conversion|retention|accuracy|latency|revenue|growth)\b/i,
    ],
  },
  {
    id: 'topic_shift',
    label: 'topic shift',
    preferredTypes: ['clarify', 'question'],
    priority: 9,
    patterns: [
      /\b(now|next|moving on|switching|separately|another thing|different point)\b/i,
    ],
  },
];

const HINGLISH_MARKERS = [
  /[\u0900-\u097F]/,
  /\b(kya|kyun|kaise|kar|karo|karna|kar lo|hai|hain|nahi|nahin|aaj|kal|abhi|thoda|matlab|samajh|bata|bolo|chalo)\b/i,
];

function clampPositiveInteger(value, fallback) {
  const parsedValue = Number(value);

  if (!Number.isInteger(parsedValue) || parsedValue <= 0) {
    return fallback;
  }

  return parsedValue;
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

function formatTime(value) {
  return new Date(value).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatTranscriptChunk(chunk, index) {
  return `${index + 1}. [${formatTime(chunk.startedAt)} - ${formatTime(chunk.endedAt)}] ${
    chunk.text
  }`;
}

function formatChatMessage(message, index) {
  const role = String(message?.role ?? 'assistant').toUpperCase();
  const source = normalizeInlineText(message?.source) || 'unknown';
  const text =
    normalizeInlineText(message?.text) || 'No message content provided.';

  return `${index + 1}. [${formatTime(message?.createdAt)}] ${role} (${source}): ${text}`;
}

function joinChunkText(transcriptChunks = []) {
  return normalizeInlineText(
    transcriptChunks
      .map((chunk) => normalizeInlineText(chunk?.text))
      .filter(Boolean)
      .join(' '),
  );
}

function countPatternMatches(text, patterns) {
  return patterns.reduce(
    (score, pattern) => score + (pattern.test(text) ? 1 : 0),
    0,
  );
}

function splitEvidenceSegments(text) {
  return normalizeInlineText(text)
    .split(/(?<=[.!?])\s+|\s+-\s+|\n+/)
    .map((segment) => normalizeInlineText(segment))
    .filter(Boolean);
}

function findPatternEvidence(text, patterns) {
  const segments = splitEvidenceSegments(text);
  const matchingSegment = segments.find((segment) =>
    patterns.some((pattern) => pattern.test(segment)),
  );

  return matchingSegment
    ? truncateText(matchingSegment, MAX_SIGNAL_EVIDENCE_LENGTH)
    : '';
}

function formatEvidence(value) {
  const evidence = normalizeInlineText(value);

  return evidence ? `; evidence: "${evidence}"` : '';
}

function detectLanguageStyle(text) {
  const normalizedText = normalizeInlineText(text);

  if (!normalizedText) {
    return {
      evidence: '',
      instruction:
        'No language signal yet; use concise English until the transcript shows otherwise',
      label: 'not enough signal',
    };
  }

  const isHinglish = HINGLISH_MARKERS.some((pattern) =>
    pattern.test(normalizedText),
  );

  if (isHinglish) {
    return {
      evidence: findPatternEvidence(normalizedText, HINGLISH_MARKERS),
      instruction:
        'Use natural Hinglish when it makes the suggestion easier to say; keep product or technical terms in English',
      label: 'Hinglish or mixed Hindi-English',
    };
  }

  return {
    evidence: '',
    instruction:
      'Use crisp conversational English and mirror any domain terms from the transcript',
    label: 'English',
  };
}

function detectSpeakerSignal(recentTranscriptChunks = []) {
  const textWithBreaks = recentTranscriptChunks
    .map((chunk) => String(chunk?.text ?? ''))
    .join('\n');
  const speakerPattern =
    /(?:^|\n)\s*([A-Z][\w .-]{0,24}|speaker\s*\d+|person\s*\d+|interviewer|candidate|client|customer|host|guest):/gi;
  const speakerCounts = new Map();
  let match = speakerPattern.exec(textWithBreaks);

  while (match) {
    const speaker = normalizeInlineText(match[1]).toLowerCase();

    speakerCounts.set(speaker, (speakerCounts.get(speaker) ?? 0) + 1);
    match = speakerPattern.exec(textWithBreaks);
  }

  const totalMentions = [...speakerCounts.values()].reduce(
    (sum, count) => sum + count,
    0,
  );

  if (totalMentions === 0) {
    return 'No reliable speaker labels found; avoid speaker-specific advice unless the transcript says it explicitly.';
  }

  const [dominantSpeaker, dominantCount] = [...speakerCounts.entries()].sort(
    (first, second) => second[1] - first[1],
  )[0];

  if (speakerCounts.size > 1 && dominantCount / totalMentions >= 0.7) {
    return `Speaker labels suggest ${dominantSpeaker} is dominating; consider a card that invites another stakeholder in if it fits the moment.`;
  }

  return `${speakerCounts.size} labeled speakers detected; suggestions may reference the active speaker only when the text makes it clear.`;
}

function getContextTokens(value) {
  return normalizeInlineText(value)
    .toLowerCase()
    .split(/[^a-z0-9]+/i)
    .filter(
      (token) =>
        token.length >= 4 && !CONTEXT_STOP_WORDS.has(token),
    );
}

function calculateTokenSimilarity(firstText, secondText) {
  const firstTokens = new Set(getContextTokens(firstText));
  const secondTokens = new Set(getContextTokens(secondText));

  if (firstTokens.size === 0 || secondTokens.size === 0) {
    return 0;
  }

  let overlapCount = 0;

  firstTokens.forEach((token) => {
    if (secondTokens.has(token)) {
      overlapCount += 1;
    }
  });

  return overlapCount / Math.max(firstTokens.size, secondTokens.size);
}

function detectTopicShift(recentTranscriptChunks = []) {
  if (recentTranscriptChunks.length < 2) {
    return 'No topic-shift signal yet.';
  }

  const previousText = joinChunkText(recentTranscriptChunks.slice(-3, -1));
  const latestText = joinChunkText(recentTranscriptChunks.slice(-1));
  const latestSignalsShift = TRIGGER_RULES.find(
    (rule) => rule.id === 'topic_shift',
  )?.patterns.some((pattern) => pattern.test(latestText));

  if (latestSignalsShift) {
    return 'Latest chunk explicitly signals a topic shift; prefer a clarifying or re-anchor card.';
  }

  const similarity = calculateTokenSimilarity(previousText, latestText);

  if (
    getContextTokens(previousText).length >= 5 &&
    getContextTokens(latestText).length >= 5 &&
    similarity < 0.18
  ) {
    return 'Latest chunk appears to move away from the previous topic; anchor suggestions in the newest topic.';
  }

  return 'No major topic shift detected; maintain continuity with the recent thread.';
}

function uniqueTypes(types) {
  const seenTypes = new Set();

  return types.filter((type) => {
    if (seenTypes.has(type)) {
      return false;
    }

    seenTypes.add(type);
    return true;
  });
}

function createSuggestedMix({ mode, triggerEvents }) {
  const triggerIds = new Set(triggerEvents.map((triggerEvent) => triggerEvent.id));
  const reservedTypes = [];

  if (triggerIds.has('question_asked')) {
    reservedTypes.push('answer');
  }

  if (
    triggerIds.has('decision_point') ||
    triggerIds.has('deadline_or_timeline') ||
    triggerIds.has('action_item')
  ) {
    reservedTypes.push('next_step');
  }

  if (triggerIds.has('risk_or_blocker')) {
    reservedTypes.push('risk');
  }

  if (
    triggerIds.has('metric_or_claim') ||
    triggerIds.has('budget_or_pricing')
  ) {
    reservedTypes.push('fact_check');
  }

  if (
    triggerIds.has('disagreement') ||
    triggerIds.has('topic_shift')
  ) {
    reservedTypes.push('clarify');
  }

  const triggerTypes = triggerEvents.flatMap(
    (triggerEvent) => triggerEvent.preferredTypes,
  );
  const modeTypes = mode.preferredMix ?? [];
  const fallbackTypes = ['answer', 'question', 'risk', 'next_step', 'clarify'];

  return uniqueTypes([
    ...reservedTypes,
    ...triggerTypes,
    ...modeTypes,
    ...fallbackTypes,
  ]).slice(0, 3);
}

export function analyzeConversationSignals({
  recentTranscriptChunks,
  transcriptChunks = [],
} = {}) {
  const recentChunks =
    Array.isArray(recentTranscriptChunks) && recentTranscriptChunks.length > 0
      ? recentTranscriptChunks
      : transcriptChunks.slice(-4);
  const recentText = joinChunkText(recentChunks);
  const fullText = joinChunkText(transcriptChunks);
  const textForAnalysis = recentText || fullText;
  const scoredModes = MODE_RULES.map((rule) => {
    const score =
      countPatternMatches(recentText, rule.patterns) * 2 +
      countPatternMatches(fullText, rule.patterns);

    return {
      ...rule,
      evidence:
        findPatternEvidence(recentText, rule.patterns) ||
        findPatternEvidence(fullText, rule.patterns),
      score,
    };
  }).sort((first, second) => second.score - first.score);
  const bestMode =
    scoredModes[0]?.score > 0
      ? scoredModes[0]
      : {
          evidence: '',
          id: 'active_discussion',
          label: 'active discussion',
          preferredMix: ['question', 'answer', 'clarify'],
          score: 0,
        };
  const triggerEvents = TRIGGER_RULES.map((rule) => {
    const score =
      countPatternMatches(recentText, rule.patterns) * 2 +
      countPatternMatches(fullText, rule.patterns);

    return {
      ...rule,
      evidence:
        findPatternEvidence(recentText, rule.patterns) ||
        findPatternEvidence(fullText, rule.patterns),
      score,
    };
  })
    .filter((rule) => rule.score > 0)
    .sort((first, second) =>
      first.priority === second.priority
        ? second.score - first.score
        : first.priority - second.priority,
    )
    .slice(0, MAX_TRIGGER_EVENTS);
  const mode = {
    confidence:
      bestMode.score >= 5 ? 'high' : bestMode.score >= 2 ? 'medium' : 'low',
    evidence: bestMode.evidence,
    id: bestMode.id,
    label: bestMode.label,
    preferredMix: bestMode.preferredMix,
  };

  return {
    languageStyle: detectLanguageStyle(textForAnalysis),
    mode,
    secondaryModes: scoredModes
      .filter((rule) => rule.id !== bestMode.id && rule.score > 0)
      .slice(0, 2)
      .map((rule) => rule.label),
    speakerSignal: detectSpeakerSignal(recentChunks),
    suggestedMix: createSuggestedMix({
      mode,
      triggerEvents,
    }),
    topicSignal: detectTopicShift(recentChunks),
    triggerEvents: triggerEvents.map((triggerEvent) => ({
      evidence: triggerEvent.evidence,
      id: triggerEvent.id,
      label: triggerEvent.label,
      preferredTypes: triggerEvent.preferredTypes,
    })),
  };
}

function formatConversationIntelligence(signals) {
  const secondaryModesText =
    signals.secondaryModes.length > 0
      ? signals.secondaryModes.join(', ')
      : 'none detected';
  const triggerText =
    signals.triggerEvents.length > 0
      ? signals.triggerEvents
          .map(
            (triggerEvent) =>
              `${triggerEvent.label}${formatEvidence(triggerEvent.evidence)}`,
          )
          .join('; ')
      : 'No strong trigger event detected; stay useful but cautious.';

  return [
    `- Detected mode: ${signals.mode.label} (${signals.mode.confidence} confidence${formatEvidence(
      signals.mode.evidence,
    )}).`,
    `- Secondary modes: ${secondaryModesText}.`,
    `- Live trigger events: ${triggerText}`,
    `- Language style: ${signals.languageStyle.label}. ${signals.languageStyle.instruction}${formatEvidence(
      signals.languageStyle.evidence,
    )}.`,
    `- Speaker signal: ${signals.speakerSignal}`,
    `- Topic signal: ${signals.topicSignal}`,
    `- Target card mix: ${signals.suggestedMix.join(', ')}.`,
  ].join('\n');
}

function createEarlierContextDigest(transcriptChunks) {
  if (transcriptChunks.length === 0) {
    return 'No earlier transcript context.';
  }

  return transcriptChunks
    .slice(-MAX_DIGEST_CHUNKS)
    .map((chunk, index) => {
      const excerpt = truncateText(
        normalizeInlineText(chunk.text),
        MAX_DIGEST_TEXT_LENGTH,
      );

      return `- Earlier point ${index + 1}: ${excerpt}`;
    })
    .join('\n');
}

function formatSuggestionHistory(suggestionBatches = [], maxHistoryBatches = 3) {
  const recentSuggestionBatches = suggestionBatches
    .filter(
      (batch) =>
        Array.isArray(batch?.suggestions) && batch.suggestions.length > 0,
    )
    .slice(0, maxHistoryBatches);

  if (recentSuggestionBatches.length === 0) {
    return 'No prior suggestion batches in this session.';
  }

  return recentSuggestionBatches
    .map((batch, batchIndex) => {
      const titles = batch.suggestions
        .map((suggestion, suggestionIndex) => {
          const type = normalizeInlineText(suggestion?.type) || 'unknown';
          const title = normalizeInlineText(suggestion?.title);
          const preview = truncateText(
            normalizeInlineText(suggestion?.preview),
            100,
          );

          return title
            ? `${suggestionIndex + 1}. [${type}] ${title}${preview ? ` -> ${preview}` : ''}`
            : '';
        })
        .filter(Boolean)
        .join(' | ');

      return `Batch ${batchIndex + 1}: ${titles}`;
    })
    .join('\n');
}

function createSuggestionQualityInstructions(resolvedSettings) {
  const instructions = [
    '- Each suggestion must represent a different conversational job, not a paraphrase of another suggestion.',
    '- Make the preview useful on its own by naming the actual question, point, response angle, or fact to verify.',
    '- Use the language and specifics from the transcript instead of generic business phrasing.',
    '- Favor what is most timely in the latest transcript chunk unless earlier context clearly matters.',
    '- Let the detected meeting mode change the card strategy: sales needs objections and next questions, planning needs owners and risk, debugging needs constraints and verification, interviews need answer framing and follow-up questions.',
    '- If Hinglish is detected, mirror that mixed style naturally for user-sayable previews.',
  ];

  if (resolvedSettings.guardrails.avoidDuplicateSuggestions) {
    instructions.push(
      '- Treat recent suggestion batches as constraints and avoid reusing the same title pattern, angle, or preview unless the conversation direction clearly changed.',
    );
  }

  if (resolvedSettings.guardrails.rejectGenericSuggestions) {
    instructions.push(
      '- Reject generic advice such as "ask a follow-up question", "show empathy", or "summarize the discussion" unless you spell out the exact move grounded in transcript details.',
    );
  }

  return instructions.join('\n');
}

export function createSuggestionPromptContext({
  previousSuggestionBatches = [],
  settings,
  transcriptChunks = [],
}) {
  const resolvedSettings = mergeSettings(settings);
  const suggestionHistoryBatches = Math.min(
    MAX_HISTORY_BATCHES_CAP,
    clampPositiveInteger(
      resolvedSettings.guardrails?.suggestionHistoryBatches,
      3,
    ),
  );
  const suggestionWindow = clampPositiveInteger(
    resolvedSettings.contextWindows.suggestions,
    6,
  );
  const recentTranscriptChunks = transcriptChunks.slice(-suggestionWindow);
  const olderTranscriptChunks = transcriptChunks.slice(
    0,
    Math.max(0, transcriptChunks.length - recentTranscriptChunks.length),
  );
  const conversationSignals = analyzeConversationSignals({
    recentTranscriptChunks,
    transcriptChunks,
  });

  return {
    conversationIntelligenceText:
      formatConversationIntelligence(conversationSignals),
    conversationSignals,
    earlierContextDigest: createEarlierContextDigest(olderTranscriptChunks),
    previousSuggestionsText: formatSuggestionHistory(
      previousSuggestionBatches,
      suggestionHistoryBatches,
    ),
    recentTranscriptChunks,
    recentTranscriptText: recentTranscriptChunks
      .map(formatTranscriptChunk)
      .join('\n'),
    resolvedSettings,
  };
}

function joinTranscript(transcriptChunks, limit) {
  const resolvedLimit = clampPositiveInteger(
    limit,
    transcriptChunks.length || 1,
  );

  return transcriptChunks
    .slice(-resolvedLimit)
    .map(formatTranscriptChunk)
    .join('\n');
}

function createFocusedTranscriptText(
  transcriptChunks,
  focusTranscriptIds = [],
) {
  const focusIds = new Set(
    focusTranscriptIds
      .map((value) => normalizeInlineText(value))
      .filter(Boolean),
  );

  if (focusIds.size === 0) {
    return 'No focused transcript moments were provided.';
  }

  const focusedChunks = transcriptChunks.filter((chunk) =>
    focusIds.has(chunk.id),
  );

  if (focusedChunks.length === 0) {
    return 'No focused transcript moments matched the provided ids.';
  }

  return focusedChunks
    .slice(-MAX_FOCUSED_TRANSCRIPT_CHUNKS)
    .map(formatTranscriptChunk)
    .join('\n');
}

function formatChatHistory(chatHistory = []) {
  if (!Array.isArray(chatHistory) || chatHistory.length === 0) {
    return 'No prior chat messages in this session.';
  }

  return chatHistory
    .slice(-MAX_CHAT_HISTORY_MESSAGES)
    .map(formatChatMessage)
    .join('\n');
}

export function buildLiveSuggestionPrompt({
  previousSuggestionBatches = [],
  settings,
  transcriptChunks = [],
  validationFeedback = '',
}) {
  const {
    conversationIntelligenceText,
    earlierContextDigest,
    previousSuggestionsText,
    recentTranscriptText,
    resolvedSettings,
  } = createSuggestionPromptContext({
    previousSuggestionBatches,
    settings,
    transcriptChunks,
  });

  return `
${resolvedSettings.prompts.liveSuggestion}

Return JSON only with this shape:
{
  "suggestions": [
    {
      "type": "question | talking_point | answer | fact_check | clarify | risk | next_step",
      "title": "short label",
      "preview": "the useful live suggestion the user can act on immediately",
      "reason": "brief explanation of why this matters now"
    }
  ]
}

Rules:
- Return exactly 3 suggestions.
- Keep all 3 suggestions meaningfully different from one another.
- Hit at least ${clampPositiveInteger(
    resolvedSettings.guardrails.minimumSuggestionTypeVariety,
    3,
  )} distinct suggestion types across the batch when the transcript supports it.
- Make the previews specific enough to help even before the user clicks.
- Prefer the target card mix from conversation intelligence when the transcript supports it.
- Keep all cards actionable: the user should be able to say, ask, verify, or assign the preview immediately.
- Do not paste long transcript excerpts into previews; quote at most 12 words from the transcript when needed.
- Use "risk" for missing fallback/owner/dependency/monitoring/privacy/security concerns.
- Use "next_step" when the transcript points to ownership, deadline, handoff, decision, or follow-up.
- Prefer a varied mix across question, talking_point, answer, fact_check, clarify, risk, and next_step.
- Keep titles under 80 characters.
- Keep previews under 220 characters.
- Keep reasons under 140 characters.
- If the transcript does not support a fact check, use another high-value type instead.
- The reason should be a trust label, for example: "Deadline detected", "Recent question", "Possible risk", or "Planning mode".

Quality bar:
${createSuggestionQualityInstructions(resolvedSettings)}

Conversation intelligence:
${conversationIntelligenceText}

Earlier transcript digest:
${earlierContextDigest}

Recent transcript context:
${recentTranscriptText || 'No transcript provided yet.'}

Recent suggestion history to avoid repeating:
${previousSuggestionsText}

${validationFeedback ? `Validation feedback from the last attempt:\n${validationFeedback}\n` : ''}
  `.trim();
}

export function buildDetailedAnswerPrompt({
  chatHistory = [],
  focusTranscriptIds = [],
  settings,
  suggestion,
  transcriptChunks = [],
}) {
  const resolvedSettings = mergeSettings(settings);
  const answerWindow = resolvedSettings.contextWindows.answers;
  const transcriptText = joinTranscript(
    transcriptChunks,
    answerWindow,
  );
  const recentTranscriptChunks = transcriptChunks.slice(
    -clampPositiveInteger(answerWindow, 10),
  );
  const conversationIntelligenceText = formatConversationIntelligence(
    analyzeConversationSignals({
      recentTranscriptChunks,
      transcriptChunks,
    }),
  );
  const focusedTranscriptText = createFocusedTranscriptText(
    transcriptChunks,
    focusTranscriptIds,
  );
  const suggestionType = normalizeInlineText(suggestion?.type) || 'unknown';
  const suggestionTitle =
    normalizeInlineText(suggestion?.title) ||
    'No suggestion title was provided.';
  const suggestionPreview =
    normalizeInlineText(suggestion?.preview) ||
    'No suggestion preview was provided.';
  const suggestionReason =
    normalizeInlineText(suggestion?.reason) ||
    'No suggestion rationale was provided.';

  return `
${resolvedSettings.prompts.detailedAnswer}

Return plain text only.
Expand the clicked suggestion into a practical response the user can say or adapt immediately.
Prefer a compact structure with:
- a direct answer or talking point first in 1 to 2 sentences
- 2 to 4 short bullets or a short supporting paragraph
- a closing next step or clarifying question when helpful
- avoid generic filler, throat-clearing, or repeating the prompt
- preserve Hinglish or mixed-language style when the transcript uses it
- do not invent owners, dates, numbers, decisions, or technical facts that are not in the transcript
- do not use markdown emphasis like **bold**, __underline__, headings, or code fences

Clicked suggestion:
- Type: ${suggestionType}
- Title: ${suggestionTitle}
- Preview: ${suggestionPreview}
- Why it matters now: ${suggestionReason}

Conversation intelligence:
${conversationIntelligenceText}

Recent chat history:
${formatChatHistory(chatHistory)}

Focused transcript moments:
${focusedTranscriptText}

Additional recent transcript context:
${transcriptText || 'No transcript provided yet.'}
  `.trim();
}

export function buildChatPrompt({
  chatHistory = [],
  settings,
  transcriptChunks = [],
  message,
}) {
  const resolvedSettings = mergeSettings(settings);
  const answerWindow = resolvedSettings.contextWindows.answers;
  const transcriptText = joinTranscript(
    transcriptChunks,
    answerWindow,
  );
  const recentTranscriptChunks = transcriptChunks.slice(
    -clampPositiveInteger(answerWindow, 10),
  );
  const conversationIntelligenceText = formatConversationIntelligence(
    analyzeConversationSignals({
      recentTranscriptChunks,
      transcriptChunks,
    }),
  );

  return `
${resolvedSettings.prompts.chat}

Return plain text only.
Answer the latest user message using the current session context.
If the transcript does not support a factual claim, state the uncertainty clearly instead of guessing.
Keep the response concise enough to help during a live conversation.
Lead with the direct answer, then add only the most relevant support.
- adapt the answer to the detected meeting mode and live trigger when useful
- preserve Hinglish or mixed-language style when the transcript uses it
- do not use markdown emphasis like **bold**, __underline__, headings, or code fences

Latest user message:
${normalizeInlineText(message) || 'No message provided yet.'}

Conversation intelligence:
${conversationIntelligenceText}

Recent chat history:
${formatChatHistory(chatHistory)}

Transcript context:
${transcriptText || 'No transcript provided yet.'}
  `.trim();
}
