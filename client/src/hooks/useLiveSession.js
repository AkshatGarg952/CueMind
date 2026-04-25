import { useEffect, useRef, useState } from 'react';
import {
  DEFAULT_AUDIO_CHUNK_INTERVAL_MS,
  MAX_AUDIO_CHUNK_INTERVAL_MS,
  MAX_AUDIO_UPLOAD_BYTES,
  MIN_AUDIO_CHUNK_INTERVAL_MS,
  PREFERRED_RECORDER_MIME_TYPES,
  isSupportedAudioMimeType,
  normalizeAudioMimeType,
} from '@shared/audioFormats.js';
import { requestSuggestionRefresh, transcribeAudioChunk } from '../utils/api.js';

const AUDIO_LEVEL_SAMPLE_INTERVAL_MS = 250;
const SPEECH_RMS_THRESHOLD = 0.018;
const SPEECH_PEAK_RMS_THRESHOLD = 0.045;
const MIN_SPEECH_SAMPLE_COUNT = 3;
const AUTO_SUGGESTION_REFRESH_INTERVAL_MS = 15000;

export function useLiveSession({
  onSuggestionBatch,
  suggestionBatches,
  onTranscriptChunk,
  settings,
  transcriptChunks,
}) {
  const [errorMessage, setErrorMessage] = useState('');
  const [isManualRefreshing, setIsManualRefreshing] = useState(false);
  const [isRecorderActive, setIsRecorderActive] = useState(false);
  const [isSuggestionRefreshing, setIsSuggestionRefreshing] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [statusMessage, setStatusMessage] = useState(
    'Add your Groq API key, then start the microphone to build a rolling live transcript.',
  );

  const chunkQueueRef = useRef([]);
  const chunkStopTimeoutRef = useRef(null);
  const flushWaitersRef = useRef([]);
  const isRecordingSessionActiveRef = useRef(false);
  const isMountedRef = useRef(true);
  const isProcessingQueueRef = useRef(false);
  const mediaRecorderRef = useRef(null);
  const mediaStreamRef = useRef(null);
  const nextChunkStartedAtRef = useRef(null);
  const onSuggestionBatchRef = useRef(onSuggestionBatch);
  const onTranscriptChunkRef = useRef(onTranscriptChunk);
  const queueIdleWaitersRef = useRef([]);
  const recorderHandlersRef = useRef(createEmptyRecorderHandlers());
  const recorderMimeTypeRef = useRef('');
  const shouldRerunSuggestionRefreshRef = useRef(false);
  const shouldRestartRecorderAfterStopRef = useRef(false);
  const shouldSuppressAutoRefreshRef = useRef(false);
  const sessionRevisionRef = useRef(0);
  const settingsRef = useRef(settings);
  const audioContextRef = useRef(null);
  const audioLevelTimerRef = useRef(null);
  const audioAnalyserRef = useRef(null);
  const autoSuggestionRefreshTimerRef = useRef(null);
  const lastAutoSuggestionRefreshAtRef = useRef(0);
  const speechStatsRef = useRef(createEmptySpeechStats());
  const suggestionBatchesRef = useRef(suggestionBatches);
  const suggestionRefreshInFlightRef = useRef(false);
  const stopWaitersRef = useRef([]);
  const transcriptChunksRef = useRef(transcriptChunks);

  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  useEffect(() => {
    transcriptChunksRef.current = transcriptChunks;
  }, [transcriptChunks]);

  useEffect(() => {
    suggestionBatchesRef.current = suggestionBatches;
  }, [suggestionBatches]);

  useEffect(() => {
    onTranscriptChunkRef.current = onTranscriptChunk;
  }, [onTranscriptChunk]);

  useEffect(() => {
    onSuggestionBatchRef.current = onSuggestionBatch;
  }, [onSuggestionBatch]);

  useEffect(() => {
    return () => {
      isMountedRef.current = false;
      chunkQueueRef.current = [];
      resolveWaiters(flushWaitersRef);
      resolveWaiters(queueIdleWaitersRef);
      resolveWaiters(stopWaitersRef);
      isRecordingSessionActiveRef.current = false;
      shouldRestartRecorderAfterStopRef.current = false;
      teardownRecordingSession({
        chunkStopTimeoutRef,
        mediaRecorderRef,
        mediaStreamRef,
        nextChunkStartedAtRef,
        audioContextRef,
        audioLevelTimerRef,
        audioAnalyserRef,
        speechStatsRef,
        recorderHandlersRef,
        recorderMimeTypeRef,
        skipRecorderStop: true,
      });
      shouldRerunSuggestionRefreshRef.current = false;
      shouldSuppressAutoRefreshRef.current = false;
      suggestionRefreshInFlightRef.current = false;
      clearAutoSuggestionRefreshTimer(autoSuggestionRefreshTimerRef);
      lastAutoSuggestionRefreshAtRef.current = 0;
    };
  }, []);

  const recordingState = isRecorderActive
    ? 'recording'
    : errorMessage
      ? 'error'
      : isTranscribing || isManualRefreshing || isSuggestionRefreshing
        ? 'processing'
        : 'idle';
  const activityLabel = errorMessage && isRecorderActive
    ? 'Mic live with issue'
    : errorMessage
      ? 'Action needed'
      : isManualRefreshing
      ? 'Manual refresh'
      : isSuggestionRefreshing
        ? 'Generating suggestions'
        : isTranscribing
          ? 'Transcribing audio'
          : isRecorderActive
            ? 'Mic live'
            : 'Waiting to start';

  async function handleRecordingToggle() {
    if (isRecorderActive) {
      await stopRecording();
      return;
    }

    await startRecording();
  }

  async function handleManualRefresh() {
    if (isManualRefreshing || isSuggestionRefreshing) {
      return;
    }

    try {
      setErrorMessage('');
      setIsManualRefreshing(true);
      shouldSuppressAutoRefreshRef.current = true;
      clearAutoSuggestionRefreshTimer(autoSuggestionRefreshTimerRef);
      setStatusMessage(
        isRecorderActive
          ? 'Syncing the latest audio chunk first, then refreshing suggestions from the newest transcript context.'
          : 'Refreshing suggestions from the newest transcript context.',
      );

      await flushPendingAudio();
      await refreshSuggestions('manual');
    } catch (error) {
      setErrorMessage(normalizeErrorMessage(error));
      setStatusMessage('Fix the issue above, then try refreshing again.');
    } finally {
      shouldSuppressAutoRefreshRef.current = false;

      if (isMountedRef.current) {
        setIsManualRefreshing(false);
      }
    }
  }

  async function startRecording() {
    const sessionRevision = sessionRevisionRef.current;

    try {
      setErrorMessage('');

      if (!settingsRef.current?.groqApiKey) {
        throw new Error(
          'Add your Groq API key in Settings before starting the microphone.',
        );
      }

      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error('This browser does not support microphone access.');
      }

      if (typeof MediaRecorder === 'undefined') {
        throw new Error('This browser does not support MediaRecorder audio capture.');
      }

      const mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          autoGainControl: true,
          echoCancellation: true,
          noiseSuppression: true,
        },
      });

      if (sessionRevision !== sessionRevisionRef.current) {
        mediaStream.getTracks().forEach((track) => track.stop());
        return;
      }

      const mimeType = getSupportedAudioMimeType();
      mediaStreamRef.current = mediaStream;
      recorderMimeTypeRef.current = mimeType;
      startAudioLevelMonitoring({
        audioAnalyserRef,
        audioContextRef,
        audioLevelTimerRef,
        mediaStream,
        speechStatsRef,
      });
      isRecordingSessionActiveRef.current = true;
      shouldRestartRecorderAfterStopRef.current = false;

      const recorderChunkIntervalMs = getChunkIntervalMs(
        settingsRef.current?.refreshIntervalMs,
      );

      startRecorderCycle({
        chunkIntervalMs: recorderChunkIntervalMs,
        startedAt: new Date().toISOString(),
      });

      setIsRecorderActive(true);
      setStatusMessage(
        `Recording live audio. A new transcript chunk should land about every ${formatDurationLabel(
          recorderChunkIntervalMs,
        )}. Brief pauses between thoughts help each chunk close cleanly before the next one starts.`,
      );
    } catch (error) {
      if (sessionRevision !== sessionRevisionRef.current) {
        return;
      }

      isRecordingSessionActiveRef.current = false;
      shouldRestartRecorderAfterStopRef.current = false;
      teardownRecordingSession({
        chunkStopTimeoutRef,
        mediaRecorderRef,
        mediaStreamRef,
        nextChunkStartedAtRef,
        audioContextRef,
        audioLevelTimerRef,
        audioAnalyserRef,
        speechStatsRef,
        recorderHandlersRef,
        recorderMimeTypeRef,
        skipRecorderStop: true,
      });
      setIsRecorderActive(false);
      setErrorMessage(normalizeErrorMessage(error));
      setStatusMessage('Microphone recording could not be started.');
    }
  }

  function startRecorderCycle({ chunkIntervalMs, startedAt }) {
    const activeStream = mediaStreamRef.current;

    if (!activeStream || !isRecordingSessionActiveRef.current) {
      return;
    }

    const recorder = recorderMimeTypeRef.current
      ? new MediaRecorder(activeStream, {
          mimeType: recorderMimeTypeRef.current,
        })
      : new MediaRecorder(activeStream);
    const chunkStartedAt = startedAt || new Date().toISOString();

    nextChunkStartedAtRef.current = chunkStartedAt;
    resetSpeechStats(speechStatsRef);

    const recorderHandlers = {
      onDataAvailable: (event) => {
        const endedAt = new Date().toISOString();
        const normalizedMimeType = normalizeAudioMimeType(
          event.data?.type || recorder.mimeType || recorderMimeTypeRef.current,
        );

        nextChunkStartedAtRef.current = endedAt;
        resolveWaiters(flushWaitersRef);

        if (!event.data || event.data.size === 0) {
          setStatusMessage('The latest audio chunk was empty. Keep speaking and try again.');
          resolveQueueIdleIfReady({
            chunkQueueRef,
            isProcessingQueueRef,
            queueIdleWaitersRef,
          });
          return;
        }

        if (isLikelySilentAudioChunk(speechStatsRef.current)) {
          setStatusMessage(
            'Mic is live, but no clear speech was detected in the latest chunk, so TwinMind skipped it.',
          );
          resetSpeechStats(speechStatsRef);
          resolveQueueIdleIfReady({
            chunkQueueRef,
            isProcessingQueueRef,
            queueIdleWaitersRef,
          });
          return;
        }

        if (!isSupportedAudioMimeType(normalizedMimeType)) {
          stopRecordingSessionWithError(
            new Error(
              `TwinMind captured an unsupported audio format (${normalizedMimeType}). Try Chrome or Edge, or restart the microphone.`,
            ),
            'Recording stopped because the latest audio chunk format was unsupported.',
            {
              skipRecorderStop: false,
            },
          );
          return;
        }

        if (event.data.size > MAX_AUDIO_UPLOAD_BYTES) {
          stopRecordingSessionWithError(
            new Error(
              `The latest audio chunk was ${formatFileSize(
                event.data.size,
              )}, which is too large to transcribe reliably. TwinMind now keeps chunks short, but if this happens again set the refresh interval closer to ${formatDurationLabel(
                DEFAULT_AUDIO_CHUNK_INTERVAL_MS,
              )}.`,
            ),
            'Recording stopped because the latest audio chunk was too large.',
            {
              skipRecorderStop: false,
            },
          );
          return;
        }

        chunkQueueRef.current.push({
          blob: event.data,
          endedAt,
          mimeType: normalizedMimeType,
          startedAt: chunkStartedAt,
        });
        resetSpeechStats(speechStatsRef);
        void processChunkQueue();
      },
      onRecorderError: (event) => {
        const recorderError = event.error || new Error('Microphone recording failed.');

        stopRecordingSessionWithError(recorderError, 'Microphone recording failed.', {
          skipRecorderStop: true,
        });
      },
      onRecorderStop: () => {
        const shouldRestart =
          isRecordingSessionActiveRef.current &&
          shouldRestartRecorderAfterStopRef.current;
        const nextChunkStartedAt =
          nextChunkStartedAtRef.current || new Date().toISOString();

        shouldRestartRecorderAfterStopRef.current = false;
        clearChunkStopTimer(chunkStopTimeoutRef);
        detachRecorderInstance({
          mediaRecorderRef,
          recorderHandlersRef,
          skipRecorderStop: true,
        });
        resolveWaiters(flushWaitersRef);
        resolveWaiters(stopWaitersRef);

        if (shouldRestart) {
          startRecorderCycle({
            chunkIntervalMs: getChunkIntervalMs(settingsRef.current?.refreshIntervalMs),
            startedAt: nextChunkStartedAt,
          });
          return;
        }

        if (!isRecordingSessionActiveRef.current) {
          stopMediaStream(mediaStreamRef);
          recorderMimeTypeRef.current = '';
          nextChunkStartedAtRef.current = null;
          setIsRecorderActive(false);
        }

        resolveQueueIdleIfReady({
          chunkQueueRef,
          isProcessingQueueRef,
          queueIdleWaitersRef,
        });
      },
    };

    mediaRecorderRef.current = recorder;
    recorderHandlersRef.current = recorderHandlers;

    recorder.addEventListener('dataavailable', recorderHandlers.onDataAvailable);
    recorder.addEventListener('error', recorderHandlers.onRecorderError);
    recorder.addEventListener('stop', recorderHandlers.onRecorderStop);
    recorder.start();
    clearChunkStopTimer(chunkStopTimeoutRef);
    chunkStopTimeoutRef.current = setTimeout(() => {
      stopActiveRecorder({
        restartAfterStop: true,
      });
    }, chunkIntervalMs);
  }

  async function stopRecording() {
    const activeRecorder = mediaRecorderRef.current;

    if (!activeRecorder || activeRecorder.state === 'inactive') {
      isRecordingSessionActiveRef.current = false;
      shouldRestartRecorderAfterStopRef.current = false;
      teardownRecordingSession({
        chunkStopTimeoutRef,
        mediaRecorderRef,
        mediaStreamRef,
        nextChunkStartedAtRef,
        audioContextRef,
        audioLevelTimerRef,
        audioAnalyserRef,
        speechStatsRef,
        recorderHandlersRef,
        recorderMimeTypeRef,
        skipRecorderStop: true,
      });
      setIsRecorderActive(false);
      return;
    }

    isRecordingSessionActiveRef.current = false;
    setErrorMessage('');
    setStatusMessage(
      'Stopping the microphone and finishing any pending transcription before the session settles.',
    );

    const stopPromise = waitForSignal(stopWaitersRef);
    stopActiveRecorder({
      restartAfterStop: false,
    });

    await stopPromise;
    await waitForQueueIdle();

    if (isMountedRef.current) {
      setStatusMessage('Recording stopped. The transcript is up to date.');
    }
  }

  async function flushPendingAudio() {
    const activeRecorder = mediaRecorderRef.current;

    if (activeRecorder && activeRecorder.state !== 'inactive') {
      const flushPromise = waitForSignal(flushWaitersRef);
      stopActiveRecorder({
        restartAfterStop: true,
      });
      await flushPromise;
    }

    await waitForQueueIdle();
  }

  async function waitForQueueIdle() {
    if (!isProcessingQueueRef.current && chunkQueueRef.current.length === 0) {
      return;
    }

    await waitForSignal(queueIdleWaitersRef);
  }

  function stopActiveRecorder({ restartAfterStop }) {
    const activeRecorder = mediaRecorderRef.current;

    if (!activeRecorder || activeRecorder.state === 'inactive') {
      return false;
    }

    shouldRestartRecorderAfterStopRef.current =
      restartAfterStop && isRecordingSessionActiveRef.current;
    clearChunkStopTimer(chunkStopTimeoutRef);

    try {
      activeRecorder.stop();
      return true;
    } catch {
      return false;
    }
  }

  function stopRecordingSessionWithError(
    error,
    nextStatusMessage,
    { skipRecorderStop = true } = {},
  ) {
    chunkQueueRef.current = [];
    isRecordingSessionActiveRef.current = false;
    shouldRestartRecorderAfterStopRef.current = false;
    shouldRerunSuggestionRefreshRef.current = false;
    shouldSuppressAutoRefreshRef.current = false;
    suggestionRefreshInFlightRef.current = false;
    clearAutoSuggestionRefreshTimer(autoSuggestionRefreshTimerRef);
    lastAutoSuggestionRefreshAtRef.current = 0;
    teardownRecordingSession({
      chunkStopTimeoutRef,
      mediaRecorderRef,
      mediaStreamRef,
      nextChunkStartedAtRef,
      audioContextRef,
      audioLevelTimerRef,
      audioAnalyserRef,
      speechStatsRef,
      recorderHandlersRef,
      recorderMimeTypeRef,
      skipRecorderStop,
    });
    setIsRecorderActive(false);
    setErrorMessage(normalizeErrorMessage(error));
    setStatusMessage(nextStatusMessage);
    resolveWaiters(flushWaitersRef);
    resolveWaiters(stopWaitersRef);
    resolveWaiters(queueIdleWaitersRef);
  }

  async function processChunkQueue() {
    if (isProcessingQueueRef.current) {
      return;
    }

    isProcessingQueueRef.current = true;
    setIsTranscribing(true);

    try {
      while (chunkQueueRef.current.length > 0) {
        const nextChunk = chunkQueueRef.current.shift();
        const sessionRevision = sessionRevisionRef.current;
        try {
          const transcriptionResponse = await transcribeAudioChunk({
            audioBlob: nextChunk.blob,
            endedAt: nextChunk.endedAt,
            mimeType: nextChunk.mimeType,
            settings: settingsRef.current,
            startedAt: nextChunk.startedAt,
          });

          if (sessionRevision !== sessionRevisionRef.current) {
            continue;
          }

          if (transcriptionResponse?.transcriptChunk) {
            const transcriptChunk = transcriptionResponse.transcriptChunk;

            transcriptChunksRef.current = [
              ...transcriptChunksRef.current,
              transcriptChunk,
            ];
            onTranscriptChunkRef.current(transcriptChunk);
            setErrorMessage('');

            if (shouldSuppressAutoRefreshRef.current) {
              setStatusMessage(
                `Transcript updated at ${formatTimestamp(
                  transcriptChunk.endedAt,
                )}. Suggestions will refresh when the sync completes.`,
              );
            } else {
              scheduleAutoSuggestionRefresh(transcriptChunk);
            }
          } else if (transcriptionResponse?.message) {
            setStatusMessage(transcriptionResponse.message);
          }
        } catch (error) {
          if (sessionRevision !== sessionRevisionRef.current) {
            continue;
          }

          setErrorMessage(normalizeErrorMessage(error));
          setStatusMessage(
            'The latest audio chunk could not be transcribed. Recording can continue, and you can retry on the next chunk or use manual refresh.',
          );
        }
      }
    } finally {
      isProcessingQueueRef.current = false;

      if (isMountedRef.current) {
        setIsTranscribing(false);
      }

      resolveWaiters(queueIdleWaitersRef);
    }
  }

  return {
    activityLabel,
    errorMessage,
    handleManualRefresh,
    handleRecordingToggle,
    isManualRefreshing,
    isSuggestionRefreshing,
    recordingState,
    resetLiveSession,
    statusMessage,
  };

  async function refreshSuggestions(origin) {
    const requestSessionRevision = sessionRevisionRef.current;

    if (transcriptChunksRef.current.length === 0) {
      setStatusMessage('Suggestions need at least one transcript chunk before they can refresh.');
      return;
    }

    if (suggestionRefreshInFlightRef.current) {
      shouldRerunSuggestionRefreshRef.current = true;
      return;
    }

    suggestionRefreshInFlightRef.current = true;

    if (isMountedRef.current) {
      setIsSuggestionRefreshing(true);
    }

    try {
      do {
        shouldRerunSuggestionRefreshRef.current = false;

        const refreshResponse = await requestSuggestionRefresh({
          previousSuggestionBatches: suggestionBatchesRef.current,
          settings: settingsRef.current,
          transcriptChunks: transcriptChunksRef.current,
        });

        if (requestSessionRevision !== sessionRevisionRef.current) {
          return;
        }

        if (refreshResponse?.batch) {
          lastAutoSuggestionRefreshAtRef.current = Date.now();
          suggestionBatchesRef.current = [
            refreshResponse.batch,
            ...suggestionBatchesRef.current,
          ];
          onSuggestionBatchRef.current(refreshResponse.batch);
          setErrorMessage('');
          setStatusMessage(
            origin === 'manual'
              ? 'Transcript synced. Suggestions were refreshed successfully.'
              : `Fresh suggestions generated at ${formatTimestamp(
                  refreshResponse.batch.createdAt,
                )}.`,
          );
        } else {
          setStatusMessage('Suggestions could not be refreshed from the current transcript.');
        }
      } while (shouldRerunSuggestionRefreshRef.current);
    } catch (error) {
      if (requestSessionRevision !== sessionRevisionRef.current) {
        return;
      }

      setErrorMessage(normalizeErrorMessage(error));
      setStatusMessage('Suggestion refresh failed. Fix the issue above, then try again.');
      throw error;
    } finally {
      suggestionRefreshInFlightRef.current = false;

      if (isMountedRef.current) {
        setIsSuggestionRefreshing(false);
      }
    }
  }

  function scheduleAutoSuggestionRefresh(transcriptChunk) {
    const now = Date.now();
    const hasNoSuggestionBatches = suggestionBatchesRef.current.length === 0;
    const elapsedSinceLastRefresh = now - lastAutoSuggestionRefreshAtRef.current;
    const transcriptUpdatedMessage = `Transcript updated at ${formatTimestamp(
      transcriptChunk.endedAt,
    )}.`;

    if (
      hasNoSuggestionBatches ||
      elapsedSinceLastRefresh >= AUTO_SUGGESTION_REFRESH_INTERVAL_MS
    ) {
      clearAutoSuggestionRefreshTimer(autoSuggestionRefreshTimerRef);
      setStatusMessage(`${transcriptUpdatedMessage} Generating a fresh suggestion batch...`);
      void refreshSuggestions('auto').catch(() => {});
      return;
    }

    if (autoSuggestionRefreshTimerRef.current) {
      setStatusMessage(
        `${transcriptUpdatedMessage} Suggestions are queued for the next live refresh.`,
      );
      return;
    }

    const delayMs = Math.max(
      0,
      AUTO_SUGGESTION_REFRESH_INTERVAL_MS - elapsedSinceLastRefresh,
    );

    setStatusMessage(
      `${transcriptUpdatedMessage} Suggestions will refresh in about ${formatDurationLabel(
        delayMs,
      )}.`,
    );
    autoSuggestionRefreshTimerRef.current = window.setTimeout(() => {
      autoSuggestionRefreshTimerRef.current = null;
      void refreshSuggestions('auto').catch(() => {});
    }, delayMs);
  }

  async function resetLiveSession() {
    sessionRevisionRef.current += 1;
    chunkQueueRef.current = [];
    shouldRerunSuggestionRefreshRef.current = false;
    shouldRestartRecorderAfterStopRef.current = false;
    shouldSuppressAutoRefreshRef.current = false;
    suggestionRefreshInFlightRef.current = false;
    clearAutoSuggestionRefreshTimer(autoSuggestionRefreshTimerRef);
    lastAutoSuggestionRefreshAtRef.current = 0;
    resolveWaiters(flushWaitersRef);
    resolveWaiters(queueIdleWaitersRef);
    resolveWaiters(stopWaitersRef);
    isRecordingSessionActiveRef.current = false;
    teardownRecordingSession({
      chunkStopTimeoutRef,
      mediaRecorderRef,
      mediaStreamRef,
      nextChunkStartedAtRef,
      audioContextRef,
      audioLevelTimerRef,
      audioAnalyserRef,
      speechStatsRef,
      recorderHandlersRef,
      recorderMimeTypeRef,
      skipRecorderStop: false,
    });

    if (isMountedRef.current) {
      setErrorMessage('');
      setIsManualRefreshing(false);
      setIsRecorderActive(false);
      setIsSuggestionRefreshing(false);
      setIsTranscribing(false);
      setStatusMessage(
        'Session cleared. Start the microphone to build a fresh transcript and suggestion history.',
      );
    }
  }
}

function createEmptyRecorderHandlers() {
  return {
    onDataAvailable: null,
    onRecorderError: null,
    onRecorderStop: null,
  };
}

function createEmptySpeechStats() {
  return {
    peakRms: 0,
    sampleCount: 0,
    speechSampleCount: 0,
  };
}

function resetSpeechStats(speechStatsRef) {
  speechStatsRef.current = createEmptySpeechStats();
}

function startAudioLevelMonitoring({
  audioAnalyserRef,
  audioContextRef,
  audioLevelTimerRef,
  mediaStream,
  speechStatsRef,
}) {
  stopAudioLevelMonitoring({
    audioAnalyserRef,
    audioContextRef,
    audioLevelTimerRef,
  });

  const AudioContextConstructor =
    window.AudioContext || window.webkitAudioContext;

  if (!AudioContextConstructor) {
    return;
  }

  const audioContext = new AudioContextConstructor();
  const analyser = audioContext.createAnalyser();
  const source = audioContext.createMediaStreamSource(mediaStream);

  analyser.fftSize = 2048;
  source.connect(analyser);
  audioContextRef.current = audioContext;
  audioAnalyserRef.current = analyser;
  resetSpeechStats(speechStatsRef);

  const samples = new Uint8Array(analyser.fftSize);

  audioLevelTimerRef.current = window.setInterval(() => {
    analyser.getByteTimeDomainData(samples);

    const rms = calculateRmsFromTimeDomain(samples);
    const nextStats = {
      peakRms: Math.max(speechStatsRef.current.peakRms, rms),
      sampleCount: speechStatsRef.current.sampleCount + 1,
      speechSampleCount:
        speechStatsRef.current.speechSampleCount +
        (rms >= SPEECH_RMS_THRESHOLD ? 1 : 0),
    };

    speechStatsRef.current = nextStats;
  }, AUDIO_LEVEL_SAMPLE_INTERVAL_MS);
}

function stopAudioLevelMonitoring({
  audioAnalyserRef,
  audioContextRef,
  audioLevelTimerRef,
}) {
  if (audioLevelTimerRef.current) {
    window.clearInterval(audioLevelTimerRef.current);
    audioLevelTimerRef.current = null;
  }

  audioAnalyserRef.current = null;

  if (audioContextRef.current) {
    void audioContextRef.current.close().catch(() => {});
    audioContextRef.current = null;
  }
}

function calculateRmsFromTimeDomain(samples) {
  let sumOfSquares = 0;

  samples.forEach((sample) => {
    const centeredSample = (sample - 128) / 128;
    sumOfSquares += centeredSample * centeredSample;
  });

  return Math.sqrt(sumOfSquares / samples.length);
}

function isLikelySilentAudioChunk(stats) {
  if (!stats || stats.sampleCount === 0) {
    return false;
  }

  return (
    stats.speechSampleCount < MIN_SPEECH_SAMPLE_COUNT &&
    stats.peakRms < SPEECH_PEAK_RMS_THRESHOLD
  );
}

function waitForSignal(waitersRef) {
  return new Promise((resolve) => {
    waitersRef.current.push(resolve);
  });
}

function resolveWaiters(waitersRef) {
  const waiters = waitersRef.current.splice(0, waitersRef.current.length);

  waiters.forEach((resolve) => resolve());
}

function resolveQueueIdleIfReady({
  chunkQueueRef,
  isProcessingQueueRef,
  queueIdleWaitersRef,
}) {
  if (!isProcessingQueueRef.current && chunkQueueRef.current.length === 0) {
    resolveWaiters(queueIdleWaitersRef);
  }
}

function teardownRecordingSession({
  chunkStopTimeoutRef,
  mediaRecorderRef,
  mediaStreamRef,
  nextChunkStartedAtRef,
  audioContextRef,
  audioLevelTimerRef,
  audioAnalyserRef,
  speechStatsRef,
  recorderHandlersRef,
  recorderMimeTypeRef,
  skipRecorderStop,
}) {
  clearChunkStopTimer(chunkStopTimeoutRef);
  detachRecorderInstance({
    mediaRecorderRef,
    recorderHandlersRef,
    skipRecorderStop,
  });
  stopAudioLevelMonitoring({
    audioAnalyserRef,
    audioContextRef,
    audioLevelTimerRef,
  });
  stopMediaStream(mediaStreamRef);
  nextChunkStartedAtRef.current = null;
  recorderMimeTypeRef.current = '';
  resetSpeechStats(speechStatsRef);
}

function detachRecorderInstance({
  mediaRecorderRef,
  recorderHandlersRef,
  skipRecorderStop,
}) {
  const activeRecorder = mediaRecorderRef.current;
  const recorderHandlers = recorderHandlersRef.current;

  if (activeRecorder) {
    if (recorderHandlers.onDataAvailable) {
      activeRecorder.removeEventListener('dataavailable', recorderHandlers.onDataAvailable);
    }

    if (recorderHandlers.onRecorderError) {
      activeRecorder.removeEventListener('error', recorderHandlers.onRecorderError);
    }

    if (recorderHandlers.onRecorderStop) {
      activeRecorder.removeEventListener('stop', recorderHandlers.onRecorderStop);
    }

    if (!skipRecorderStop && activeRecorder.state !== 'inactive') {
      try {
        activeRecorder.stop();
      } catch {
        // Nothing else to do here if the recorder has already stopped.
      }
    }
  }

  mediaRecorderRef.current = null;
  recorderHandlersRef.current = createEmptyRecorderHandlers();
}

function clearChunkStopTimer(chunkStopTimeoutRef) {
  if (chunkStopTimeoutRef.current) {
    clearTimeout(chunkStopTimeoutRef.current);
    chunkStopTimeoutRef.current = null;
  }
}

function clearAutoSuggestionRefreshTimer(autoSuggestionRefreshTimerRef) {
  if (autoSuggestionRefreshTimerRef.current) {
    window.clearTimeout(autoSuggestionRefreshTimerRef.current);
    autoSuggestionRefreshTimerRef.current = null;
  }
}

function stopMediaStream(mediaStreamRef) {
  const activeStream = mediaStreamRef.current;

  if (activeStream) {
    activeStream.getTracks().forEach((track) => track.stop());
  }

  mediaStreamRef.current = null;
}

function getChunkIntervalMs(refreshIntervalMs) {
  const parsedValue = Number(refreshIntervalMs);

  if (!Number.isFinite(parsedValue)) {
    return DEFAULT_AUDIO_CHUNK_INTERVAL_MS;
  }

  return Math.min(
    MAX_AUDIO_CHUNK_INTERVAL_MS,
    Math.max(MIN_AUDIO_CHUNK_INTERVAL_MS, parsedValue),
  );
}

function getSupportedAudioMimeType() {
  return PREFERRED_RECORDER_MIME_TYPES.find((mimeType) =>
    typeof MediaRecorder.isTypeSupported === 'function'
      ? MediaRecorder.isTypeSupported(mimeType)
      : false,
  );
}

function normalizeErrorMessage(error) {
  if (!error) {
    return 'Something went wrong while handling the live session.';
  }

  if (
    typeof error === 'object' &&
    'name' in error &&
    error.name === 'NotAllowedError'
  ) {
    return 'Microphone permission was denied. Allow microphone access and try again.';
  }

  if (
    typeof error === 'object' &&
    'message' in error &&
    typeof error.message === 'string' &&
    error.message.trim()
  ) {
    return error.message;
  }

  return 'Something went wrong while handling the live session.';
}

function formatTimestamp(value) {
  return new Date(value).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatDurationLabel(durationMs) {
  const durationInSeconds = Math.round(durationMs / 1000);

  return durationInSeconds === 30
    ? '30 seconds'
    : `${durationInSeconds} seconds`;
}

function formatFileSize(sizeInBytes) {
  return `${(sizeInBytes / (1024 * 1024)).toFixed(1)} MB`;
}
