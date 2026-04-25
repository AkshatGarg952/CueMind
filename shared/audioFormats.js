export const DEFAULT_AUDIO_CHUNK_INTERVAL_MS = 30000;
export const MIN_AUDIO_CHUNK_INTERVAL_MS = 3000;
export const MAX_AUDIO_CHUNK_INTERVAL_MS = 30000;
export const MAX_AUDIO_UPLOAD_BYTES = 24 * 1024 * 1024;
export const DEFAULT_AUDIO_UPLOAD_MIME_TYPE = 'audio/webm';

export const PREFERRED_RECORDER_MIME_TYPES = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/mp4',
  'audio/ogg;codecs=opus',
];

const AUDIO_MIME_TYPE_ALIASES = {
  'audio/mp3': 'audio/mpeg',
  'audio/ogg;codecs=opus': 'audio/ogg',
  'audio/webm;codecs=opus': 'audio/webm',
  'audio/x-m4a': 'audio/mp4',
  'audio/x-wav': 'audio/wav',
};

const AUDIO_FILE_EXTENSIONS = {
  'audio/mp4': 'mp4',
  'audio/mpeg': 'mp3',
  'audio/ogg': 'ogg',
  'audio/wav': 'wav',
  'audio/webm': 'webm',
};

export function normalizeAudioMimeType(mimeType) {
  if (typeof mimeType !== 'string') {
    return DEFAULT_AUDIO_UPLOAD_MIME_TYPE;
  }

  const trimmedMimeType = mimeType.trim().toLowerCase();

  if (!trimmedMimeType) {
    return DEFAULT_AUDIO_UPLOAD_MIME_TYPE;
  }

  const mimeTypeWithoutParameters = trimmedMimeType.split(';', 1)[0];

  return (
    AUDIO_MIME_TYPE_ALIASES[trimmedMimeType] ||
    AUDIO_MIME_TYPE_ALIASES[mimeTypeWithoutParameters] ||
    mimeTypeWithoutParameters
  );
}

export function isSupportedAudioMimeType(mimeType) {
  return Object.hasOwn(AUDIO_FILE_EXTENSIONS, normalizeAudioMimeType(mimeType));
}

export function getAudioFileExtension(mimeType) {
  return (
    AUDIO_FILE_EXTENSIONS[normalizeAudioMimeType(mimeType)] ||
    AUDIO_FILE_EXTENSIONS[DEFAULT_AUDIO_UPLOAD_MIME_TYPE]
  );
}

export function buildAudioFileName(endedAt, mimeType) {
  const extension = getAudioFileExtension(mimeType);
  const safeTimestamp = String(endedAt || new Date().toISOString()).replaceAll(':', '-');

  return `twinmind-${safeTimestamp}.${extension}`;
}
