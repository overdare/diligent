// @summary Detail panel showing full JSON and metadata for selected session entry
import { useCallback } from "react";
import { JsonViewer } from "./JsonViewer.js";

interface DetailInspectorProps {
  entry: unknown;
  onClose: () => void;
}

function getEntryType(entry: Record<string, unknown>): string {
  if (entry.type === "session_header") return "Session Header";
  if (entry.type === "compaction") return "Compaction";
  if (entry.type === "model_change") return "Model Change";
  if (entry.type === "session_info") return "Session Info";
  if (entry.type === "mode_change") return "Mode Change";
  if (entry.type === "effort_change") return "Effort Change";
  if (entry.type === "steering") return "Steering";
  if (entry.type === "error") return "Error";
  if (entry.role === "user") return "User Message";
  if (entry.role === "assistant") return "Assistant Message";
  if (entry.role === "tool_result") return "Tool Result";
  if (entry.call) return "Tool Call Pair";
  if (entry.type === "tool_call") return "Tool Call";
  return "Unknown";
}

function getEntryId(entry: Record<string, unknown>): string {
  if (entry.id) return entry.id as string;
  if (entry.call && typeof entry.call === "object" && "id" in (entry.call as Record<string, unknown>)) {
    return (entry.call as Record<string, unknown>).id as string;
  }
  return "n/a";
}

function getTimestamp(entry: Record<string, unknown>): number | null {
  if (typeof entry.timestamp === "number") return entry.timestamp;
  if (typeof entry.startTime === "number") return entry.startTime;
  return null;
}

export function DetailInspector({ entry, onClose }: DetailInspectorProps) {
  const obj = entry as Record<string, unknown>;
  const type = getEntryType(obj);
  const id = getEntryId(obj);
  const timestamp = getTimestamp(obj);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(JSON.stringify(entry, null, 2));
  }, [entry]);

  return (
    <div className="detail-inspector">
      <div className="detail-header">
        <span className="detail-type-badge">{type}</span>
        <button type="button" className="detail-close" onClick={onClose}>
          &times;
        </button>
      </div>

      <div className="detail-meta">
        <div className="detail-meta-row">
          <span className="detail-meta-label">ID</span>
          <span className="detail-meta-value mono">{id}</span>
        </div>
        {timestamp && (
          <div className="detail-meta-row">
            <span className="detail-meta-label">Time</span>
            <span className="detail-meta-value">{new Date(timestamp).toLocaleString()}</span>
          </div>
        )}
        {typeof obj.model === "string" && (
          <div className="detail-meta-row">
            <span className="detail-meta-label">Model</span>
            <span className="detail-meta-value mono">{obj.model}</span>
          </div>
        )}
        {typeof obj.usage === "object" && obj.usage !== null && (
          <div className="detail-meta-row">
            <span className="detail-meta-label">Usage</span>
            <span className="detail-meta-value">
              {(obj.usage as Record<string, number>).inputTokens}in /{" "}
              {(obj.usage as Record<string, number>).outputTokens}out
            </span>
          </div>
        )}
        {typeof obj.stopReason === "string" && (
          <div className="detail-meta-row">
            <span className="detail-meta-label">Stop</span>
            <span className="detail-meta-value mono">{obj.stopReason}</span>
          </div>
        )}
      </div>

      <div className="detail-actions">
        <button type="button" className="detail-copy-btn" onClick={handleCopy}>
          Copy JSON
        </button>
      </div>

      <div className="detail-json">
        <JsonViewer data={entry} collapsed={3} />
      </div>
    </div>
  );
}
