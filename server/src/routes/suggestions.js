import express from 'express';
import { ensureGroqApiKey } from '../services/groqClient.js';
import { buildLiveSuggestionPrompt } from '../services/promptBuilders.js';
import {
  readArray,
  readOptionalPlainObject,
} from '../services/requestValidation.js';
import { generateLiveSuggestionBatch } from '../services/suggestionService.js';

const router = express.Router();

router.post('/', async (request, response, next) => {
  try {
    const body = readOptionalPlainObject(request.body, 'request body') ?? {};
    const previousSuggestionBatches = readArray(
      body.previousSuggestionBatches,
      'previousSuggestionBatches',
    );
    const settings = readOptionalPlainObject(body.settings, 'settings');
    const transcriptChunks = readArray(body.transcriptChunks, 'transcriptChunks');

    ensureGroqApiKey(settings?.groqApiKey);

    const suggestionBatch = await generateLiveSuggestionBatch({
      previousSuggestionBatches,
      settings,
      transcriptChunks,
    });

    response.json({
      status: 'ok',
      promptPreview: buildLiveSuggestionPrompt({
        previousSuggestionBatches,
        settings,
        transcriptChunks,
      }).slice(0, 320),
      requestId: suggestionBatch.requestId,
      batch: suggestionBatch.batch,
    });
  } catch (error) {
    next(error);
  }
});

export default router;
