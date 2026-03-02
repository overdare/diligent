// @summary Accessible modal wrapper for approval and request-user-input prompts
import type { ReactNode } from "react";

interface ModalProps {
  title: string;
  description?: string;
  children: ReactNode;
}

export function Modal({ title, description, children }: ModalProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" role="presentation">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="w-full max-w-lg rounded-lg border border-text/20 bg-surface p-4 shadow-panel"
      >
        <h2 className="text-lg font-semibold text-text">{title}</h2>
        {description ? <p className="mt-1 text-sm text-muted">{description}</p> : null}
        <div className="mt-4">{children}</div>
      </div>
    </div>
  );
}
