import type { ExtensionConfig, SessionStats } from './contracts';

export interface SessionStatsMessage {
  type: 'session-stats';
  payload: SessionStats;
}

export interface GetActiveSessionStatsMessage {
  type: 'get-active-session-stats';
}

export interface GetConfigMessage {
  type: 'get-config';
}

export interface UpdateConfigMessage {
  type: 'update-config';
  payload: Partial<ExtensionConfig>;
}

export interface ClearSnapshotCacheMessage {
  type: 'clear-snapshot-cache';
}

export type RuntimeMessage =
  | ClearSnapshotCacheMessage
  | GetActiveSessionStatsMessage
  | GetConfigMessage
  | SessionStatsMessage
  | UpdateConfigMessage;

export function isRuntimeMessage(value: unknown): value is RuntimeMessage {
  if (!value || typeof value !== 'object' || !('type' in value)) {
    return false;
  }

  const message = value as { payload?: unknown; type?: unknown };

  switch (message.type) {
    case 'session-stats':
      return hasSessionStatsPayload(message.payload);
    case 'get-active-session-stats':
    case 'get-config':
    case 'clear-snapshot-cache':
      return true;
    case 'update-config':
      return !!message.payload && typeof message.payload === 'object';
    default:
      return false;
  }
}

function hasSessionStatsPayload(payload: unknown): payload is SessionStats {
  if (!payload || typeof payload !== 'object') {
    return false;
  }

  const stats = payload as Partial<SessionStats>;
  return (
    typeof stats.sessionId === 'string' &&
    typeof stats.totalRecords === 'number' &&
    typeof stats.mountedCount === 'number' &&
    typeof stats.collapsedGroupCount === 'number' &&
    typeof stats.adapterConfidence === 'number'
  );
}
