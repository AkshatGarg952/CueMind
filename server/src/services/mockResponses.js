import {
  createChatMessage,
  createSuggestion,
  createSuggestionBatch,
} from '../../../shared/sessionModels.js';
import { buildDetailedAnswerPrompt } from './promptBuilders.js';

export function createStubSuggestionBatch(transcriptChunks = []) {
  const latestChunk = transcriptChunks.at(-1);
  const latestText = latestChunk?.text ?? 'the current conversation';

  return createSuggestionBatch({
    basedOnTranscriptIds: transcriptChunks.map((chunk) => chunk.id),
    suggestions: [
      createSuggestion({
        type: 'question',
        title: 'Ask for the strongest success criterion',
        preview: `Turn "${latestText}" into a concrete follow-up question that reveals the decision standard.`,
        reason: 'Decision clarity',
      }),
      createSuggestion({
        type: 'talking_point',
        title: 'Offer a bounded next-step framing',
        preview:
          'Respond with confidence while keeping implementation promises narrow and verifiable.',
        reason: 'Planning mode',
      }),
      createSuggestion({
        type: 'risk',
        title: 'Clarify scope before confirming support',
        preview:
          'If the transcript implies commitments, pin down timeline, owners, and expected depth of help.',
        reason: 'Possible commitment risk',
      }),
    ],
  });
}

export function createStubChatReply(message) {
  return createChatMessage({
    role: 'assistant',
    source: 'generated_answer',
    text: `Stub reply for "${message || 'the current request'}". Replace this with the Groq-backed answer path on Day 4.`,
  });
}

export function createStubDetailedAnswer({ settings, transcriptChunks, suggestionTitle }) {
  return createChatMessage({
    role: 'assistant',
    source: 'generated_answer',
    text: buildDetailedAnswerPrompt({
      settings,
      transcriptChunks,
      suggestionTitle,
    }),
  });
}
