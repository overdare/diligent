// @summary Right-aligned user message bubble

interface UserMessageProps {
  text: string;
}

export function UserMessage({ text }: UserMessageProps) {
  return (
    <div className="flex justify-end py-1">
      <div className="max-w-message rounded-2xl rounded-br-sm bg-accent/15 px-4 py-2.5 ring-1 ring-accent/20">
        <p className="whitespace-pre-wrap text-sm leading-relaxed text-text">{text}</p>
      </div>
    </div>
  );
}
