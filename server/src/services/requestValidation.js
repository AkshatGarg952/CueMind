import { createGroqApiError } from './groqClient.js';

export function readArray(value, label) {
  if (value == null) {
    return [];
  }

  if (!Array.isArray(value)) {
    throw createGroqApiError(`${label} must be an array.`, 400);
  }

  return value;
}

export function readOptionalPlainObject(value, label) {
  if (value == null) {
    return null;
  }

  if (typeof value !== 'object' || Array.isArray(value)) {
    throw createGroqApiError(`${label} must be a plain object.`, 400);
  }

  return value;
}

export function readOptionalString(value, label, fallback = '') {
  if (value == null) {
    return fallback;
  }

  if (typeof value !== 'string') {
    throw createGroqApiError(`${label} must be a string.`, 400);
  }

  return value;
}

export function readOptionalIsoTimestamp(value, label, fallbackValue) {
  if (value == null || value === '') {
    return fallbackValue;
  }

  if (typeof value !== 'string') {
    throw createGroqApiError(`${label} must be an ISO timestamp string.`, 400);
  }

  const timestamp = Date.parse(value);

  if (!Number.isFinite(timestamp)) {
    throw createGroqApiError(`${label} must be a valid timestamp.`, 400);
  }

  return new Date(timestamp).toISOString();
}
