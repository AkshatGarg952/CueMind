import { useEffect, useRef } from 'react';

function formatTime(value) {
  return new Date(value).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function TranscriptPanel({
  isRecording,
  refreshIntervalMs,
  transcriptChunks,
}) {
  const scrollContainerRef = useRef(null);

  useEffect(() => {
    const scrollContainer = scrollContainerRef.current;

    if (!scrollContainer) {
      return;
    }

    scrollContainer.scrollTo({
      top: scrollContainer.scrollHeight,
      behavior: transcriptChunks.length > 1 ? 'smooth' : 'auto',
    });
  }, [transcriptChunks.length]);

  return (
    <section className="panel panel-column">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">Transcript</span>
          <h2>Live transcript</h2>
        </div>
        <div className="panel-heading__aside">
          <span className="count-badge">{transcriptChunks.length} chunks</span>
          <span className="count-badge">
            ~{Math.round(refreshIntervalMs / 1000)}s cadence
          </span>
        </div>
      </div>

      <div className="panel-scroll" ref={scrollContainerRef}>
        {transcriptChunks.length === 0 ? (
          <div className="empty-state">
            {isRecording
              ? 'TwinMind is listening now. The first transcript chunk should appear after the current recording window closes, usually in about 30 seconds.'
              : 'Start the microphone and speak naturally. TwinMind appends transcript chunks on a rolling cadence of about 30 seconds, and a brief pause between thoughts helps each chunk land cleanly.'}
          </div>
        ) : (
          <div className="stack-list">
            {transcriptChunks.map((chunk) => (
              <article className="card card--soft" key={chunk.id}>
                <div className="card-meta">
                  <span>
                    {formatTime(chunk.startedAt)} - {formatTime(chunk.endedAt)}
                  </span>
                  <span>{chunk.source}</span>
                </div>
                <p>{chunk.text}</p>
              </article>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
