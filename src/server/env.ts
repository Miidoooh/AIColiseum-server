import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

export interface ServerConfig {
  port: number;
  apiKey: string | null;
  mode: 'auto' | 'llm' | 'bots';
  judgeModel: string | null;
  tickMs: number;
  agentTimeoutMs: number;
  intermissionMs: number;
  maxTokens: number;
  temperature: number;
  rosterPath: string;
  dataDir: string;
  clientDir: string;
  corsOrigin: string;
}

function int(value: string | undefined, fallback: number, min: number, max: number): number {
  const n = Number(value);
  return Number.isFinite(n) && value !== '' && value !== undefined ? Math.min(max, Math.max(min, Math.floor(n))) : fallback;
}

export function loadConfig(cwd = process.cwd()): ServerConfig {
  const envFile = resolve(cwd, '.env');
  if (existsSync(envFile)) process.loadEnvFile(envFile);
  const env = process.env;
  const mode = env.COLISEUM_MODE === 'llm' || env.COLISEUM_MODE === 'bots' ? env.COLISEUM_MODE : 'auto';
  const temperature = Number(env.LLM_TEMPERATURE);
  return {
    port: int(env.PORT, 8787, 1, 65535),
    apiKey: env.OPENROUTER_API_KEY?.trim() || null,
    mode,
    judgeModel: env.JUDGE_MODEL?.trim() || null,
    tickMs: int(env.TICK_MS, 5000, 0, 120_000),
    agentTimeoutMs: int(env.AGENT_TIMEOUT_MS, 90_000, 1000, 600_000),
    intermissionMs: int(env.INTERMISSION_MS, 20_000, 0, 3_600_000),
    maxTokens: int(env.LLM_MAX_TOKENS, 4000, 64, 32_000),
    temperature: Number.isFinite(temperature) && env.LLM_TEMPERATURE !== '' ? Math.min(2, Math.max(0, temperature)) : 0.8,
    rosterPath: resolve(cwd, env.ROSTER_PATH || 'config/roster.json'),
    dataDir: resolve(cwd, env.DATA_DIR || 'data/matches'),
    clientDir: resolve(cwd, 'dist/client'),
    corsOrigin: env.CORS_ORIGIN?.trim() || '*',
  };
}
