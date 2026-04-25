import {
  DEFAULT_AUDIO_CHUNK_INTERVAL_MS,
  MAX_AUDIO_CHUNK_INTERVAL_MS,
  MIN_AUDIO_CHUNK_INTERVAL_MS,
} from './audioFormats.js';
import { DEFAULT_PROMPTS } from './defaultPrompts.js';

export const DEFAULT_SETTINGS_STORAGE_KEY = 'twin-mind-settings';
const CURRENT_LATENCY_PROFILE_VERSION = 3;
const LEGACY_DEFAULT_AUDIO_CHUNK_INTERVAL_MS = 5000;

export function createDefaultSettings() {
  return {
    groqApiKey: '',
    latencyProfileVersion: CURRENT_LATENCY_PROFILE_VERSION,
    prompts: {
      ...DEFAULT_PROMPTS,
    },
    contextWindows: {
      suggestions: 4,
      answers: 10,
    },
    refreshIntervalMs: DEFAULT_AUDIO_CHUNK_INTERVAL_MS,
    modelConfig: {
      suggestionsTemperature: 0.5,
      chatTemperature: 0.3,
    },
    guardrails: {
      avoidDuplicateSuggestions: true,
      rejectGenericSuggestions: true,
      minimumSuggestionTypeVariety: 3,
      suggestionHistoryBatches: 3,
    },
  };
}

export function mergeSettings(overrides = {}) {
  const defaults = createDefaultSettings();
  const shouldUpgradeLegacyDefaultInterval =
    overrides.latencyProfileVersion !== CURRENT_LATENCY_PROFILE_VERSION &&
    Number(overrides.refreshIntervalMs) === LEGACY_DEFAULT_AUDIO_CHUNK_INTERVAL_MS;
  const resolvedRefreshIntervalMs = clampRefreshIntervalMs(
    shouldUpgradeLegacyDefaultInterval
      ? defaults.refreshIntervalMs
      : overrides.refreshIntervalMs,
    defaults.refreshIntervalMs,
  );

  return {
    ...defaults,
    ...overrides,
    latencyProfileVersion: CURRENT_LATENCY_PROFILE_VERSION,
    refreshIntervalMs: resolvedRefreshIntervalMs,
    prompts: {
      ...defaults.prompts,
      ...overrides.prompts,
    },
    contextWindows: {
      ...defaults.contextWindows,
      ...overrides.contextWindows,
    },
    modelConfig: {
      ...defaults.modelConfig,
      ...overrides.modelConfig,
    },
    guardrails: {
      ...defaults.guardrails,
      ...overrides.guardrails,
    },
  };
}

function clampRefreshIntervalMs(value, fallbackValue) {
  const parsedValue = Number(value);

  if (!Number.isFinite(parsedValue)) {
    return fallbackValue;
  }

  return Math.min(
    MAX_AUDIO_CHUNK_INTERVAL_MS,
    Math.max(MIN_AUDIO_CHUNK_INTERVAL_MS, parsedValue),
  );
}
