import {
  createChatMessage,
  createSessionState,
  createSuggestion,
  createSuggestionBatch,
  createTranscriptChunk,
} from '@shared/sessionModels.js';

function minutesAgo(minutes) {
  return new Date(Date.now() - minutes * 60 * 1000).toISOString();
}

export function createInitialSessionState() {
  const transcriptChunks = [
    createTranscriptChunk({
      text: 'We should position the launch as a reliability upgrade first, not just a feature release.',
      startedAt: minutesAgo(7),
      endedAt: minutesAgo(6),
      createdAt: minutesAgo(6),
    }),
    createTranscriptChunk({
      text: 'The customer is asking whether we can commit to migration support during the first two weeks.',
      startedAt: minutesAgo(5),
      endedAt: minutesAgo(4),
      createdAt: minutesAgo(4),
    }),
  ];

  const initialBatch = createSuggestionBatch({
    createdAt: minutesAgo(3),
    basedOnTranscriptIds: transcriptChunks.map((chunk) => chunk.id),
    suggestions: [
      createSuggestion({
        type: 'question',
        title: 'Ask which migration blockers worry them most',
        preview:
          'This narrows the support conversation into concrete risks and gives you something specific to answer next.',
        reason: 'The customer asked about migration support and likely wants confidence on the highest-risk areas first.',
        createdAt: minutesAgo(3),
      }),
      createSuggestion({
        type: 'talking_point',
        title: 'Frame support as guided onboarding, not open-ended services',
        preview:
          'This keeps the promise useful but bounded and avoids sounding like unlimited consulting.',
        reason: 'The conversation is drifting toward commitments, so a tighter framing protects scope.',
        createdAt: minutesAgo(3),
      }),
      createSuggestion({
        type: 'clarify',
        title: 'Clarify what the first two weeks actually include',
        preview:
          'Name examples such as setup checks, migration review, and issue triage so the offer feels real.',
        reason: 'Specificity will make the answer more credible than a generic support promise.',
        createdAt: minutesAgo(3),
      }),
    ],
  });

  return createSessionState({
    transcriptChunks,
    suggestionBatches: [initialBatch],
    chatMessages: [
      createChatMessage({
        role: 'assistant',
        source: 'generated_answer',
        text: 'Use this scaffold to validate layout, settings, and data flow before the live audio pipeline is connected.',
        createdAt: minutesAgo(2),
      }),
    ],
  });
}

export function buildRefreshedSuggestionBatch(transcriptChunks) {
  const latestChunk = transcriptChunks.at(-1);
  const latestText = latestChunk?.text ?? 'the latest conversation segment';

  return createSuggestionBatch({
    basedOnTranscriptIds: transcriptChunks.map((chunk) => chunk.id),
    suggestions: [
      createSuggestion({
        type: 'question',
        title: 'Ask what success looks like for the next step',
        preview: `Use the latest transcript context to define a concrete outcome after: "${latestText}".`,
        reason: 'Questions that force a specific success metric reduce vague agreement.',
      }),
      createSuggestion({
        type: 'answer',
        title: 'Offer a concise response that de-risks the concern',
        preview:
          'Acknowledge the concern directly, explain the plan, and keep the promise bounded to what the team can deliver.',
        reason: 'This gives the speaker a safe response pattern for live use.',
      }),
      createSuggestion({
        type: 'fact_check',
        title: 'Verify any commitment before stating it as a promise',
        preview:
          'Pause on specifics that sound contractual, especially timing, support scope, or implementation guarantees.',
        reason: 'A light fact-check suggestion is useful when the conversation starts implying commitments.',
      }),
    ],
  });
}

export function buildExpandedSuggestionReply(suggestion) {
  return `Expanded answer for "${suggestion.title}": start with the user concern, answer it directly in one sentence, add one supporting detail from the transcript, and close with a bounded next step.`;
}

export function buildAssistantReply(userQuestion) {
  return `Day 1 placeholder response to "${userQuestion}": the chat panel is wired and ready for the dedicated Groq-backed answer flow that will be implemented on Day 4.`;
}

