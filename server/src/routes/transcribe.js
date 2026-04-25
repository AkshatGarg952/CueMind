import express from 'express';
import multer from 'multer';
import {
  MAX_AUDIO_UPLOAD_BYTES,
  buildAudioFileName,
  isSupportedAudioMimeType,
  normalizeAudioMimeType,
} from '../../../shared/audioFormats.js';
import { createTranscriptChunk } from '../../../shared/sessionModels.js';
import { createGroqApiError, ensureGroqApiKey } from '../services/groqClient.js';
import {
  readOptionalIsoTimestamp,
  readOptionalPlainObject,
} from '../services/requestValidation.js';
import { transcribeAudioChunk } from '../services/transcriptionService.js';

const router = express.Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_AUDIO_UPLOAD_BYTES,
  },
});
const SILENCE_HALLUCINATION_PHRASES = new Set([
  'e a\u00ed e a\u00ed e a\u00ed e a\u00ed e a\u00ed e a\u00ed',
  'e ai e ai e ai e ai e ai e ai',
  'hello hello hello hello hello hello',
  'if the audio is silent background noise music or unintelligible return no text',
  'thanks for watching',
  'thanks for watching.',
  '\u0434\u044f\u043a\u0443\u044e \u0437\u0430 \u043f\u0435\u0440\u0435\u0433\u043b\u044f\u0434',
  '\u0434\u044f\u043a\u0443\u044e \u0437\u0430 \u043f\u0435\u0440\u0435\u0433\u043b\u044f\u0434!',
  '\u0441\u043f\u0430\u0441\u0438\u0431\u043e \u0437\u0430 \u043f\u0440\u043e\u0441\u043c\u043e\u0442\u0440',
  '\u0441\u043f\u0430\u0441\u0438\u0431\u043e \u0437\u0430 \u043f\u0440\u043e\u0441\u043c\u043e\u0442\u0440!',
  '\u3054\u8996\u8074\u3042\u308a\u304c\u3068\u3046\u3054\u3056\u3044\u307e\u3057\u305f',
  '\u3054\u8996\u8074\u3042\u308a\u304c\u3068\u3046\u3054\u3056\u3044\u307e\u3057\u305f\u3002',
  '\uc2dc\uccad\ud574\uc8fc\uc154\uc11c \uac10\uc0ac\ud569\ub2c8\ub2e4',
  '\u0634\u0643\u0631\u0627 \u0644\u0644\u0645\u0634\u0627\u0647\u062f\u0629',
]);
const COMMON_SHORT_SILENCE_PHRASES = new Set([
  'bye',
  'bye.',
  'chau',
  'chau.',
  'tchau',
  'tchau.',
  'thank you',
  'thank you.',
]);
const SUSPICIOUS_SILENCE_SCRIPT_PATTERN =
  /[\u0400-\u04ff\u0600-\u06ff\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]/;
const SUSPICIOUS_SILENCE_SCRIPT_MATCH_PATTERN =
  /[\u0400-\u04ff\u0600-\u06ff\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]/g;

router.post('/', upload.single('audio'), async (request, response, next) => {
  try {
    const settings = parseSettingsField(request.body?.settings);
    const audioFile = request.file;
    const endedAt = readOptionalIsoTimestamp(
      request.body?.endedAt,
      'endedAt',
      new Date().toISOString(),
    );
    const startedAt = readOptionalIsoTimestamp(
      request.body?.startedAt,
      'startedAt',
      endedAt,
    );

    ensureGroqApiKey(settings?.groqApiKey);

    if (!audioFile) {
      throw createGroqApiError('Attach an audio chunk before requesting transcription.', 400);
    }

    if (!audioFile.size) {
      response.json({
        status: 'skipped',
        message: 'The latest audio chunk was empty. Keep speaking and try again.',
        transcriptChunk: null,
      });
      return;
    }

    const normalizedMimeType = normalizeAudioMimeType(audioFile.mimetype);

    if (!isSupportedAudioMimeType(normalizedMimeType)) {
      throw createGroqApiError(
        `TwinMind captured an unsupported audio format (${normalizedMimeType}). Try Chrome or Edge, or restart the microphone.`,
        415,
      );
    }

    if (audioFile.size > MAX_AUDIO_UPLOAD_BYTES) {
      throw createGroqApiError(
        'The latest audio chunk was too large to transcribe reliably. Lower the refresh interval and try again.',
        413,
      );
    }

    const transcription = await transcribeAudioChunk({
      apiKey: settings.groqApiKey,
      audioBuffer: audioFile.buffer,
      fileName: buildAudioFileName(
        endedAt,
        normalizedMimeType,
      ),
      mimeType: normalizedMimeType,
    });

    if (!transcription.text) {
      response.json({
        status: 'skipped',
        message: 'No speech was detected in the latest chunk. Keep speaking and refresh again.',
        requestId: transcription.requestId,
        transcriptChunk: null,
      });
      return;
    }

    if (
      shouldSkipLikelySilenceHallucination({
        audioFileSize: audioFile.size,
        endedAt,
        startedAt,
        text: transcription.text,
      })
    ) {
      response.json({
        status: 'skipped',
        message:
          'The latest chunk sounded like silence or background noise, so TwinMind skipped a likely false transcript.',
        requestId: transcription.requestId,
        transcriptChunk: null,
      });
      return;
    }

    response.json({
      status: 'ok',
      requestId: transcription.requestId,
      transcriptChunk: createTranscriptChunk({
        text: transcription.text,
        startedAt,
        endedAt,
        createdAt: endedAt,
        source: 'mic',
      }),
    });
  } catch (error) {
    next(error);
  }
});

export default router;

function parseSettingsField(settingsField) {
  if (settingsField == null) {
    return null;
  }

  if (typeof settingsField === 'object') {
    return readOptionalPlainObject(settingsField, 'settings');
  }

  try {
    return readOptionalPlainObject(JSON.parse(settingsField), 'settings');
  } catch {
    throw createGroqApiError('Settings payload for transcription must be valid JSON.', 400);
  }
}

function shouldSkipLikelySilenceHallucination({
  audioFileSize,
  endedAt,
  startedAt,
  text,
}) {
  const normalizedText = normalizeTranscriptText(text);

  const durationMs = getDurationMs(startedAt, endedAt);

  if (SILENCE_HALLUCINATION_PHRASES.has(normalizedText)) {
    return true;
  }

  if (
    COMMON_SHORT_SILENCE_PHRASES.has(normalizedText) &&
    (durationMs <= 4000 || audioFileSize <= 48 * 1024)
  ) {
    return true;
  }

  if (
    isSuspiciousForeignSilenceText(text) &&
    (durationMs <= 35000 || audioFileSize <= 256 * 1024)
  ) {
    return true;
  }

  return false;
}

function normalizeTranscriptText(text) {
  return String(text || '')
    .trim()
    .toLowerCase()
    .replace(/[!?,"'()[\]{}]+/g, '')
    .replace(/\s+/g, ' ');
}

function isSuspiciousForeignSilenceText(text) {
  const normalizedText = String(text || '').trim();

  if (!SUSPICIOUS_SILENCE_SCRIPT_PATTERN.test(normalizedText)) {
    return false;
  }

  const latinWordMatches = normalizedText.match(/[a-z]{3,}/gi) || [];
  const suspiciousScriptMatches =
    normalizedText.match(SUSPICIOUS_SILENCE_SCRIPT_MATCH_PATTERN) || [];

  return (
    normalizedText.length <= 80 &&
    suspiciousScriptMatches.length >= latinWordMatches.length
  );
}

function getDurationMs(startedAt, endedAt) {
  const startedAtMs = Date.parse(startedAt);
  const endedAtMs = Date.parse(endedAt);

  if (!Number.isFinite(startedAtMs) || !Number.isFinite(endedAtMs)) {
    return Number.POSITIVE_INFINITY;
  }

  return Math.max(0, endedAtMs - startedAtMs);
}
