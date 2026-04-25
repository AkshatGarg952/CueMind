import { useState } from 'react';
import {
  DEFAULT_SETTINGS_STORAGE_KEY,
  createDefaultSettings,
  mergeSettings,
} from '@shared/defaultSettings.js';
import {
  createChatMessage,
  createSessionState,
} from '@shared/sessionModels.js';
import { AppHeader } from './components/AppHeader.jsx';
import { ChatPanel } from './components/ChatPanel.jsx';
import { SettingsModal } from './components/SettingsModal.jsx';
import { SuggestionsPanel } from './components/SuggestionsPanel.jsx';
import { TranscriptPanel } from './components/TranscriptPanel.jsx';
import { useLiveSession } from './hooks/useLiveSession.js';
import { useLocalStorageState } from './hooks/useLocalStorageState.js';
import { requestChatReply } from './utils/api.js';
import {
  exportSessionAsJson,
  exportSessionAsText,
} from './utils/sessionExport.js';

const RECORDING_STATUS_LABELS = {
  idle: 'Ready',
  recording: 'Recording',
  processing: 'Working',
  error: 'Needs attention',
};

export default function App() {
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isChatResponding, setIsChatResponding] = useState(false);
  const [chatErrorMessage, setChatErrorMessage] = useState('');
  const [activeSuggestionId, setActiveSuggestionId] = useState(null);
  const [chatDraft, setChatDraft] = useState('');
  const [settings, setSettings] = useLocalStorageState(
    DEFAULT_SETTINGS_STORAGE_KEY,
    createDefaultSettings(),
    mergeSettings,
  );
  const [sessionState, setSessionState] = useState(() => createSessionState());
  const {
    activityLabel,
    errorMessage,
    handleManualRefresh,
    handleRecordingToggle,
    isManualRefreshing,
    isSuggestionRefreshing,
    recordingState,
    statusMessage,
  } = useLiveSession({
    settings,
    suggestionBatches: sessionState.suggestionBatches,
    transcriptChunks: sessionState.transcriptChunks,
    onTranscriptChunk: (transcriptChunk) => {
      setSessionState((currentState) => ({
        ...currentState,
        transcriptChunks: [...currentState.transcriptChunks, transcriptChunk],
      }));
    },
    onSuggestionBatch: (suggestionBatch) => {
      setSessionState((currentState) => ({
        ...currentState,
        suggestionBatches: [suggestionBatch, ...currentState.suggestionBatches],
      }));
    },
  });

  const statusLabel = RECORDING_STATUS_LABELS[recordingState];
  const hasSessionActivity =
    sessionState.transcriptChunks.length > 0 ||
    sessionState.suggestionBatches.length > 0 ||
    sessionState.chatMessages.length > 0;

  function handleSettingsChange(updater) {
    setSettings((currentSettings) => {
      const nextSettings =
        typeof updater === 'function' ? updater(currentSettings) : updater;

      return mergeSettings(nextSettings);
    });
  }

  function handleSuggestionSelect(suggestion) {
    if (isChatResponding) {
      return;
    }

    const chatHistory = sessionState.chatMessages;
    const focusTranscriptIds = findSuggestionFocusTranscriptIds(
      suggestion,
      sessionState.suggestionBatches,
    );
    const userMessage = createChatMessage({
      role: 'user',
      source: 'suggestion_click',
      text: suggestion.title,
      linkedSuggestionId: suggestion.id,
    });

    setChatErrorMessage('');
    setIsChatResponding(true);
    setActiveSuggestionId(suggestion.id);
    setSessionState((currentState) => ({
      ...currentState,
      chatMessages: [...currentState.chatMessages, userMessage],
    }));

    void requestChatReply({
      chatHistory,
      focusTranscriptIds,
      message: suggestion.title,
      mode: 'suggestion_click',
      settings,
      suggestion,
      transcriptChunks: sessionState.transcriptChunks,
    })
      .then((chatResponse) => {
        if (!chatResponse?.assistantMessage) {
          throw new Error(
            'The server returned an empty answer for the selected suggestion.',
          );
        }

        setSessionState((currentState) => ({
          ...currentState,
          chatMessages: [
            ...currentState.chatMessages,
            chatResponse.assistantMessage,
          ],
        }));
      })
      .catch((error) => {
        setChatErrorMessage(normalizeClientError(error));
      })
      .finally(() => {
        setIsChatResponding(false);
        setActiveSuggestionId(null);
      });
  }

  async function handleSendMessage(event) {
    event.preventDefault();

    const trimmedDraft = chatDraft.trim();

    if (!trimmedDraft || isChatResponding) {
      return;
    }

    const chatHistory = sessionState.chatMessages;
    const userMessage = createChatMessage({
      role: 'user',
      source: 'typed',
      text: trimmedDraft,
    });

    setChatErrorMessage('');
    setIsChatResponding(true);
    setSessionState((currentState) => ({
      ...currentState,
      chatMessages: [...currentState.chatMessages, userMessage],
    }));
    setChatDraft('');

    try {
      const chatResponse = await requestChatReply({
        chatHistory,
        message: trimmedDraft,
        mode: 'typed',
        settings,
        transcriptChunks: sessionState.transcriptChunks,
      });

      if (!chatResponse?.assistantMessage) {
        throw new Error('The server returned an empty assistant reply.');
      }

      setSessionState((currentState) => ({
        ...currentState,
        chatMessages: [
          ...currentState.chatMessages,
          chatResponse.assistantMessage,
        ],
      }));
    } catch (error) {
      setChatErrorMessage(normalizeClientError(error));
    } finally {
      setIsChatResponding(false);
    }
  }

  function handleExportJson() {
    exportSessionAsJson({
      sessionState,
      settings,
    });
  }

  function handleExportText() {
    exportSessionAsText({
      sessionState,
      settings,
    });
  }

  return (
    <div className="app-shell">
      <div className="app-shell__backdrop" />
      <div className="app-shell__content">
        <AppHeader
          activityLabel={activityLabel}
          feedbackMessage={errorMessage || statusMessage}
          feedbackTone={errorMessage ? 'error' : 'info'}
          isManualRefreshing={isManualRefreshing}
          isSuggestionRefreshing={isSuggestionRefreshing}
          onManualRefresh={handleManualRefresh}
          onOpenSettings={() => setIsSettingsOpen(true)}
          onToggleRecording={handleRecordingToggle}
          recordingState={recordingState}
          statusLabel={statusLabel}
        />

        <main className="workspace-grid">
          <TranscriptPanel
            isRecording={recordingState === 'recording'}
            refreshIntervalMs={settings.refreshIntervalMs}
            transcriptChunks={sessionState.transcriptChunks}
          />
          <SuggestionsPanel
            activeSuggestionId={activeSuggestionId}
            isChatResponding={isChatResponding}
            isSuggestionRefreshing={isSuggestionRefreshing}
            onSuggestionSelect={handleSuggestionSelect}
            statusMessage={statusMessage}
            suggestionBatches={sessionState.suggestionBatches}
          />
          <ChatPanel
            chatDraft={chatDraft}
            chatErrorMessage={chatErrorMessage}
            chatMessages={sessionState.chatMessages}
            hasSessionActivity={hasSessionActivity}
            isBusy={isChatResponding}
            onChatDraftChange={setChatDraft}
            onExportJson={handleExportJson}
            onExportText={handleExportText}
            onSendMessage={handleSendMessage}
          />
        </main>
      </div>

      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        onSettingsChange={handleSettingsChange}
        settings={settings}
      />
    </div>
  );
}

function findSuggestionFocusTranscriptIds(suggestion, suggestionBatches) {
  const batch = suggestionBatches.find((candidateBatch) =>
    candidateBatch.suggestions?.some(
      (candidateSuggestion) => candidateSuggestion.id === suggestion.id,
    ),
  );

  return Array.isArray(batch?.basedOnTranscriptIds)
    ? batch.basedOnTranscriptIds
    : [];
}

function normalizeClientError(error) {
  if (error && typeof error.message === 'string' && error.message.trim()) {
    return error.message;
  }

  return 'The chat request could not be completed.';
}
