import type { ApiFailure, OutboxEntry } from '../domain/types';

const BASE_DELAY = 5_000;
const MAX_DELAY = 300_000;

export function timestamp(value?: string): number {
  const parsed = value ? Date.parse(value) : NaN;
  return Number.isFinite(parsed) ? parsed : 0;
}

export function isTransient(failure: ApiFailure): boolean {
  return ['NETWORK_UNCERTAIN', 'SERVER_ERROR', 'RATE_LIMITED'].includes(failure.code);
}

/** Persist the chosen jittered deadline, rather than rerolling it on every reload. */
export function retryDeadline(
  failure: ApiFailure,
  attempts: number,
  now = Date.now(),
  random = Math.random(),
): string | undefined {
  if (!isTransient(failure)) return undefined;
  if (failure.code === 'RATE_LIMITED')
    return new Date(Math.max(now + 1_000, timestamp(failure.retryAt) || now + 60_000)).toISOString();
  const exponent = Math.min(20, Math.max(0, (Number.isFinite(attempts) ? attempts : 1) - 1));
  const jitter = 0.75 + Math.min(1, Math.max(0, random)) * 0.5;
  return new Date(now + Math.min(MAX_DELAY, BASE_DELAY * 2 ** exponent * jitter)).toISOString();
}

export function canRetry(entry: OutboxEntry): boolean {
  return entry.status === 'pending' || entry.status === 'uncertain';
}

/** An uncertain POST is eligible for discovery, never automatic retransmission. */
export function needsCreateDiscovery(entry: OutboxEntry): boolean {
  return entry.kind === 'create' && entry.status === 'uncertain';
}
