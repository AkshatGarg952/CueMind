import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { createDefaultSettings } from '../../../shared/defaultSettings.js';

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));

dotenv.config({
  path: path.resolve(currentDirectory, '../../../.env'),
});

export const runtime = {
  port: resolvePort(process.env.PORT),
  corsOrigins: resolveCorsOrigins(
    process.env.CORS_ORIGIN ??
      process.env.CORS_ORIGINS ??
      process.env.FRONTEND_URL ??
      process.env.FRONTEND_ORIGIN,
  ),
  defaults: createDefaultSettings(),
};

function resolvePort(value) {
  const parsedValue = Number(value ?? 4000);

  return Number.isInteger(parsedValue) && parsedValue > 0 ? parsedValue : 4000;
}

function resolveCorsOrigins(value) {
  return String(value ?? '')
    .split(/[,\n]/)
    .map((entry) => entry.trim())
    .map((entry) => entry.replace(/\/+$/, ''))
    .filter(Boolean);
}
