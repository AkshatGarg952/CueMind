import cors from 'cors';
import express from 'express';
import chatRouter from './routes/chat.js';
import suggestionsRouter from './routes/suggestions.js';
import transcribeRouter from './routes/transcribe.js';
import { runtime } from './config/runtime.js';

const app = express();

app.use(
  cors({
    origin(origin, callback) {
      if (!origin || runtime.corsOrigins.length === 0) {
        callback(null, true);
        return;
      }

      if (runtime.corsOrigins.includes(origin)) {
        callback(null, true);
        return;
      }

      const error = new Error(
        'This frontend origin is not allowed by the TwinMind server CORS configuration.',
      );
      error.statusCode = 403;
      callback(error);
    },
  }),
);
app.use(express.json({ limit: '2mb' }));

app.get('/api/health', (_request, response) => {
  response.json({
    status: 'ok',
    service: 'twin-mind-server',
    defaultsLoaded: Boolean(runtime.defaults),
  });
});

app.use('/api/transcribe', transcribeRouter);
app.use('/api/suggestions', suggestionsRouter);
app.use('/api/chat', chatRouter);

app.use((error, _request, response, _next) => {
  if (error?.code === 'LIMIT_FILE_SIZE') {
    response.status(413).json({
      error:
        'The latest audio chunk was too large to transcribe reliably. TwinMind now uses shorter chunks, so restart the microphone and try again.',
    });
    return;
  }

  response.status(error.statusCode ?? 500).json({
    error: error.message ?? 'Unexpected server error.',
  });
});

app.listen(runtime.port, () => {
  console.log(`Twin-Mind server listening on port ${runtime.port}`);
});
