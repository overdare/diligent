// @summary Root app component managing sessions, search, and detail view
import { useCallback, useEffect, useRef, useState } from "react";
import "./App.css";
import { ConversationView } from "./components/ConversationView.js";
import { DetailInspector } from "./components/DetailInspector.js";
import { SearchBar } from "./components/SearchBar.js";
import { SessionList } from "./components/SessionList.js";
import { UsageSummaryCard } from "./components/UsageSummaryCard.js";
import { useSearch } from "./hooks/useSearch.js";
import { useSession } from "./hooks/useSession.js";
import { useSessions } from "./hooks/useSessions.js";
import { useUsageSummary } from "./hooks/useUsageSummary.js";
import { useWebSocket } from "./hooks/useWebSocket.js";
import type { WsServerMessage } from "./lib/types.js";

export function App() {
  const { sessions, setSessions, loading: sessionsLoading } = useSessions();
  const { summary, loading: usageLoading, refetch: refetchUsage } = useUsageSummary();
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [selectedEntry, setSelectedEntry] = useState<unknown>(null);
  const { entries, setEntries, loading: sessionLoading } = useSession(selectedSessionId);
  const { query, setQuery, matches, currentMatch, currentMatchIndex, navigateNext, navigatePrev } = useSearch(entries);

  const selectedSessionIdRef = useRef(selectedSessionId);
  selectedSessionIdRef.current = selectedSessionId;

  const handleWsMessage = useCallback(
    (msg: WsServerMessage) => {
      if (msg.type === "session_updated" && msg.sessionId === selectedSessionIdRef.current) {
        setEntries((prev) => [...prev, ...msg.newEntries]);
      }
      if (msg.type === "session_created") {
        setSessions((prev) => [msg.session, ...prev]);
        refetchUsage();
      }
      if (msg.type === "session_updated") {
        refetchUsage();
      }
    },
    [refetchUsage, setEntries, setSessions],
  );

  const { connected, subscribe, unsubscribe } = useWebSocket({ onMessage: handleWsMessage });

  // Subscribe/unsubscribe to selected session
  const prevSessionRef = useRef<string | null>(null);
  useEffect(() => {
    if (prevSessionRef.current) {
      unsubscribe(prevSessionRef.current);
    }
    if (selectedSessionId) {
      subscribe(selectedSessionId);
    }
    prevSessionRef.current = selectedSessionId;
  }, [selectedSessionId, subscribe, unsubscribe]);

  const detailOpen = selectedEntry !== null;
  const isHome = selectedSessionId === null;

  return (
    <div className={`app ${detailOpen ? "detail-open" : ""}`}>
      {/* Top bar */}
      <div className="top-bar">
        <span className="top-bar-title">Diligent Debug Viewer</span>
        {!isHome && (
          <button
            type="button"
            className="top-home-button"
            onClick={() => {
              setSelectedSessionId(null);
              setSelectedEntry(null);
            }}
          >
            Home
          </button>
        )}
        {selectedSessionId && (
          <SearchBar
            query={query}
            onQueryChange={setQuery}
            matchCount={matches.length}
            currentIndex={currentMatchIndex}
            onNext={navigateNext}
            onPrev={navigatePrev}
          />
        )}
        <span
          className={`connection-indicator ${connected ? "connected" : "disconnected"}`}
          title={connected ? "Connected" : "Disconnected"}
        />
      </div>

      {/* Sidebar */}
      <div className="sidebar">
        <div className="sidebar-header">Sessions</div>
        {!isHome && (
          <button
            type="button"
            className="sidebar-home-button"
            onClick={() => {
              setSelectedSessionId(null);
              setSelectedEntry(null);
            }}
          >
            ← Back to Home
          </button>
        )}
        <SessionList
          sessions={sessions}
          selectedId={selectedSessionId}
          onSelect={(id) => {
            setSelectedSessionId(id);
            setSelectedEntry(null);
          }}
          loading={sessionsLoading}
        />
      </div>

      {/* Main content */}
      <div className="main-content">
        {selectedSessionId ? (
          <ConversationView
            entries={entries}
            onSelectEntry={setSelectedEntry}
            loading={sessionLoading}
            highlightEntryId={currentMatch?.entryId ?? null}
          />
        ) : (
          <div className="home-view">
            <div className="home-header">
              <h2 className="home-title">Home</h2>
              <p className="home-subtitle">Aggregated usage and estimated token cost across all sessions</p>
            </div>

            <UsageSummaryCard summary={summary} loading={usageLoading} className="usage-summary-home" modelLimit={8} />

            <div className="home-actions">
              <div className="home-actions-title">Recent sessions</div>
              <div className="home-session-list">
                {sessions.slice(0, 8).map((session) => (
                  <button
                    type="button"
                    key={session.id}
                    className="home-session-item"
                    onClick={() => {
                      setSelectedSessionId(session.id);
                      setSelectedEntry(null);
                    }}
                  >
                    <span className="home-session-id">{session.id}</span>
                    <span className="home-session-meta">{new Date(session.lastActivity).toLocaleString()}</span>
                  </button>
                ))}
                {sessions.length === 0 && <div className="main-empty">No sessions found</div>}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Detail panel */}
      {detailOpen && (
        <div className="detail-panel">
          <DetailInspector entry={selectedEntry} onClose={() => setSelectedEntry(null)} />
        </div>
      )}
    </div>
  );
}
