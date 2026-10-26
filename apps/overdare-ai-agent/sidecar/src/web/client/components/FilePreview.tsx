// @summary Standalone file preview page for server-owned images, documents, and directories
import type { FileReadResponse } from "@diligent/protocol";
import { useEffect, useState } from "react";
import { buildFilePreviewUrl } from "../../shared/file-routes";
import { MarkdownContent } from "./MarkdownContent";

interface FilePreviewProps {
  path: string;
  threadId?: string;
  load: (path: string, threadId?: string) => Promise<FileReadResponse>;
}

function FileContent({ file, threadId }: { file: FileReadResponse; threadId?: string }) {
  switch (file.kind) {
    case "image":
      return (
        <img
          className="mx-auto max-h-[85vh] max-w-full object-contain"
          src={`data:${file.mediaType};base64,${file.dataBase64}`}
          alt={file.name}
        />
      );
    case "markdown":
      return <MarkdownContent text={file.content} options={{ safeHtml: true, basePath: file.path, threadId }} />;
    case "text":
      return (
        <pre className="overflow-auto whitespace-pre-wrap break-words font-mono text-sm leading-6">{file.content}</pre>
      );
    case "directory":
      return (
        <ul className="divide-y divide-border">
          {file.entries.map((entry) => (
            <li key={entry.name} className="py-3">
              <a
                className="text-accent underline underline-offset-4"
                href={buildFilePreviewUrl(entry.path, { threadId })}
              >
                {entry.name}
                {entry.isDirectory ? "/" : ""}
              </a>
            </li>
          ))}
          {file.entries.length === 0 ? <li className="py-3 text-muted">This folder is empty.</li> : null}
        </ul>
      );
    case "binary":
      return (
        <p>
          This file is available to{" "}
          <a
            className="text-accent underline"
            href={`data:${file.mediaType};base64,${file.dataBase64}`}
            download={file.name}
          >
            download
          </a>
          .
        </p>
      );
  }
}

export function FilePreview({ path, threadId, load }: FilePreviewProps) {
  const [state, setState] = useState<{ file?: FileReadResponse; error?: string }>({});
  useEffect(() => {
    let cancelled = false;
    setState({});
    if (!path) {
      setState({ error: "No file path was provided." });
      return;
    }
    void load(path, threadId).then(
      (file) => {
        if (!cancelled) setState({ file });
      },
      (error) => {
        if (!cancelled) setState({ error: error instanceof Error ? error.message : String(error) });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [path, threadId, load]);

  useEffect(() => {
    if (state.file) document.title = `${state.file.name} — File preview`;
  }, [state.file]);

  return (
    <main className="min-h-screen bg-bg p-6 text-text md:p-10">
      <div className="mx-auto max-w-5xl">
        <header className="mb-8 border-b border-border pb-4">
          <p className="mb-2 text-xs uppercase tracking-wider text-muted">File preview</p>
          <h2 className="break-words text-xl font-semibold">{state.file?.name ?? "Opening file"}</h2>
          <p className="mt-2 break-all font-mono text-xs text-muted">{state.file?.path ?? path}</p>
        </header>
        {state.error ? (
          <p role="alert" className="text-danger">
            {state.error}
          </p>
        ) : state.file ? (
          <FileContent file={state.file} threadId={threadId} />
        ) : (
          <output className="text-muted">Loading file…</output>
        )}
      </div>
    </main>
  );
}
