import express from 'express';
import { ensureGroqApiKey } from '../services/groqClient.js';
import { generateChatReply } from '../services/chatService.js';
import {
  readArray,
  readOptionalPlainObject,
  readOptionalString,
} from '../services/requestValidation.js';

const router = express.Router();

router.post('/', async (request, response, next) => {
  try {
    const body = readOptionalPlainObject(request.body, 'request body') ?? {};
    const chatHistory = readArray(body.chatHistory, 'chatHistory');
    const focusTranscriptIds = readArray(
      body.focusTranscriptIds,
      'focusTranscriptIds',
    );
    const message = readOptionalString(body.message, 'message');
    const mode = readOptionalString(body.mode, 'mode', 'typed');
    const settings = readOptionalPlainObject(body.settings, 'settings');
    const suggestion = readOptionalPlainObject(body.suggestion, 'suggestion');
    const transcriptChunks = readArray(body.transcriptChunks, 'transcriptChunks');

    ensureGroqApiKey(settings?.groqApiKey);

    const chatResponse = await generateChatReply({
      chatHistory,
      focusTranscriptIds,
      message,
      mode,
      settings,
      suggestion,
      transcriptChunks,
    });

    response.json({
      status: 'ok',
      requestId: chatResponse.requestId,
      promptPreview: chatResponse.prompt.slice(0, 320),
      assistantMessage: chatResponse.assistantMessage,
    });
  } catch (error) {
    next(error);
  }
});

export default router;
