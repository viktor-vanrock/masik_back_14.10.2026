import { registerAs } from '@nestjs/config';
import { parseIntWithFallback } from '@/common/utils/parseIntWithFallback';
import { AgentEnvType, AgentMode } from './types';

const parseMode = (value: string | undefined): AgentMode => {
  const configured = value?.trim();
  if ('mock' === configured || 'ws' === configured) return configured;
  if (configured) {
    throw new Error('AGENT_MODE must be either "mock" or "ws".');
  }

  return 'production' === process.env.NODE_ENV ? 'ws' : 'mock';
};

export default registerAs('agent', (): AgentEnvType => ({
  mode: parseMode(process.env.AGENT_MODE),
  wsUrl: process.env.THIRD_PARTY_WS_URL ?? '',
  selectionUrl: process.env.FACTORY_SELECTION_URL?.trim() || undefined,
  selectionTimeoutMs: parseIntWithFallback(process.env.FACTORY_SELECTION_TIMEOUT_MS, 195_000),
  apiKey: process.env.THIRD_PARTY_API_KEY ?? '',
  maxActiveSessions: parseIntWithFallback(
    process.env.AGENT_MAX_ACTIVE_SESSIONS, 200
  ),
  maxPendingMessagesPerSession: parseIntWithFallback(
    process.env.AGENT_MAX_PENDING_MESSAGES_PER_SESSION, 32
  ),
  maxBufferedBytesPerSession: parseIntWithFallback(
    process.env.AGENT_MAX_BUFFERED_BYTES_PER_SESSION, 1_048_576
  ),
  maxPayloadBytes: parseIntWithFallback(
    process.env.AGENT_MAX_PAYLOAD_BYTES, 1_048_576
  ),
  sessionIdleTimeoutMs: parseIntWithFallback(
    process.env.AGENT_SESSION_IDLE_TIMEOUT_MS, 1_800_000
  ),
  reconnectInitialDelayMs: parseIntWithFallback(
    process.env.AGENT_RECONNECT_INITIAL_DELAY_MS, 500
  ),
  reconnectMaxDelayMs: parseIntWithFallback(
    process.env.AGENT_RECONNECT_MAX_DELAY_MS, 15_000
  ),
  reconnectMaxAttempts: parseIntWithFallback(
    process.env.AGENT_RECONNECT_MAX_ATTEMPTS, 8
  ),
  heartbeatIntervalMs: parseIntWithFallback(
    process.env.AGENT_HEARTBEAT_INTERVAL_MS, 25_000
  ),
  heartbeatTimeoutMs: parseIntWithFallback(
    process.env.AGENT_HEARTBEAT_TIMEOUT_MS, 10_000
  ),
}));
