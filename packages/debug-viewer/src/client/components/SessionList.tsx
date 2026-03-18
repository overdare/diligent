// @summary Sidebar list of available debug sessions
import type { SessionMeta } from "../lib/types.js";

interface SessionListProps {
  sessions: SessionMeta[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  loading: boolean;
}

function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleString();
}

function truncatePreview(text: string, max = 96): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length <= max) return normalized;
  return `${normalized.slice(0, max - 1)}…`;
}

export function SessionList({ sessions, selectedId, onSelect, loading }: SessionListProps) {
  if (loading) {
    return <div className="session-list-loading">Loading sessions...</div>;
  }

  if (sessions.length === 0) {
    return <div className="session-list-empty">No sessions found</div>;
  }

  return (
    <div className="session-list">
      {sessions.map((session) => (
        <button
          type="button"
          key={session.id}
          className={`session-item ${selectedId === session.id ? "selected" : ""} ${session.hasErrors ? "has-errors" : ""}`}
          onClick={() => onSelect(session.id)}
        >
          <div className="session-id">{session.id}</div>
          {session.firstUserMessage && (
            <div className="session-preview">{truncatePreview(session.firstUserMessage)}</div>
          )}
          <div className="session-meta">
            <span className="session-time">{formatTime(session.lastActivity)}</span>
            <span className="session-counts">
              {session.messageCount} msgs, {session.toolCallCount} tools
            </span>
          </div>
        </button>
      ))}
    </div>
  );
}
