# Client Components

Reusable UI components for the Diligent web interface.

```
components/
  ApprovalCard.tsx           Inline chat card for tool permission approval (once / always / reject)
  AssistantMessage.tsx       Assistant message with left decoration bar, agent icon, thinking block, and markdown content
  Badge.tsx                  Compact status badge component for mode, connection, and thread status indicators
  Button.tsx                 Variant-based button component for Web CLI actions and modal decisions
  ContentBash.tsx            Terminal-style bash display: command header + expandable output
  ContentText.tsx            Expandable preformatted text block with copy button
  CopyButton.tsx             Copy-to-clipboard button with transient "copied!" feedback
  EmptyState.tsx             Empty state with example prompt cards shown when no messages exist
  ExpandButton.tsx           Reusable show-more/less toggle button for expandable content blocks
  Input.tsx                  Text input component with consistent focus ring and semantic surface styles
  InputDock.tsx              Input dock with auto-resize textarea, send/stop controls, and status tray
  MarkdownContent.tsx        Markdown renderer using dangerouslySetInnerHTML with prose styles
  MessageList.tsx            Scrollable message feed with auto-scroll, scroll-to-bottom button, and inline prompts
  Modal.tsx                  Accessible modal wrapper for approval and request-user-input prompts
  Panel.tsx                  Surface panel component used for top bars, chat stream, and input areas
  PlanPanel.tsx              Persistent plan progress panel displayed between MessageList and InputDock
  ProviderSettingsModal.tsx  Modal for managing provider API keys and ChatGPT OAuth (connect/disconnect per provider)
  QuestionCard.tsx           Inline chat card for agent user-input questions with text/password fields
  ScrollToBottom.tsx         Fixed scroll-to-bottom button shown when user has scrolled up
  SectionLabel.tsx           Uppercase monospace section label for tool input/output and card headers
  Sidebar.tsx                Sidebar with thread list, new thread button, and relative timestamps
  StatusDot.tsx              Colored status indicator dot with optional pulse animation
  StreamBlock.tsx            Message stream renderer for user, assistant (markdown), and thinking (collapsible) blocks
  StreamingIndicator.tsx     Bouncing dots streaming indicator shown while the agent is thinking
  SystemCard.tsx             Outer wrapper card for system-level inline cards (approval, question)
  TextArea.tsx               Auto-resizing textarea capped at maxRows, Shift+Enter for newlines
  ThinkingBlock.tsx          Collapsible thinking/reasoning block — streams live while thinking, collapses when done
  ToolBlock.tsx              Tool call block with icon, summary header, and tool-type-specific expandable content
  ToolCallRow.tsx            Compact tool call row with one-line summary and click-to-expand detail panel
  UserMessage.tsx            Right-aligned user message bubble
```
