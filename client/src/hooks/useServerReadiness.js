import { useEffect, useRef, useState } from 'react';
import { requestServerHealth } from '../utils/api.js';

const HEALTH_POLL_INTERVAL_MS = 3000;
const HEALTH_REQUEST_TIMEOUT_MS = 15000;

export function useServerReadiness() {
  const [state, setState] = useState(() => ({
    attemptCount: 0,
    errorMessage: '',
    isReady: false,
    isRetrying: false,
    statusMessage:
      'Checking the TwinMind backend and waking the Render instance if it is asleep.',
  }));

  const isMountedRef = useRef(true);
  const retryTimerRef = useRef(null);
  const attemptCountRef = useRef(0);

  useEffect(() => {
    void checkServerHealth();

    return () => {
      isMountedRef.current = false;

      if (retryTimerRef.current) {
        window.clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }
    };
  }, []);

  async function checkServerHealth({ isManual = false } = {}) {
    if (retryTimerRef.current) {
      window.clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }

    const nextAttemptCount = attemptCountRef.current + 1;
    attemptCountRef.current = nextAttemptCount;

    if (isMountedRef.current) {
      setState((currentState) => ({
        ...currentState,
        attemptCount: nextAttemptCount,
        errorMessage: '',
        isRetrying: true,
        statusMessage:
          nextAttemptCount === 1 && !isManual
            ? 'Checking the TwinMind backend and waking the Render instance if it is asleep.'
            : `Still waiting for the backend to wake up on Render. Health check attempt ${nextAttemptCount} is in progress.`,
      }));
    }

    try {
      const healthResponse = await requestServerHealth({
        timeoutMs: HEALTH_REQUEST_TIMEOUT_MS,
      });

      if (!isMountedRef.current) {
        return;
      }

      setState({
        attemptCount: nextAttemptCount,
        errorMessage: '',
        isReady: true,
        isRetrying: false,
        statusMessage: `Backend ready. ${normalizeHealthMessage(healthResponse)}`,
      });
    } catch (error) {
      if (!isMountedRef.current) {
        return;
      }

      const errorMessage = normalizeHealthError(error);

      setState({
        attemptCount: nextAttemptCount,
        errorMessage,
        isReady: false,
        isRetrying: false,
        statusMessage:
          'TwinMind is waiting for the backend server to wake up before the workspace unlocks.',
      });

      retryTimerRef.current = window.setTimeout(() => {
        void checkServerHealth();
      }, HEALTH_POLL_INTERVAL_MS);
    }
  }

  return {
    ...state,
    retryNow: () => checkServerHealth({ isManual: true }),
  };
}

function normalizeHealthMessage(healthResponse) {
  if (
    healthResponse &&
    typeof healthResponse.service === 'string' &&
    healthResponse.service.trim()
  ) {
    return `${healthResponse.service} is responding normally.`;
  }

  return 'The server is responding normally.';
}

function normalizeHealthError(error) {
  if (error && typeof error.message === 'string' && error.message.trim()) {
    return error.message;
  }

  return 'TwinMind could not confirm that the backend is awake yet.';
}
