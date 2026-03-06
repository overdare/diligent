// @summary Right-aligned user message bubble with optional image attachments

interface UserMessageProps {
  text: string;
  images?: Array<{ url: string; fileName?: string; mediaType?: string }>;
}

export function UserMessage({ text, images = [] }: UserMessageProps) {
  return (
    <div className="flex justify-end py-1 pb-8">
      <div className="max-w-message rounded-2xl rounded-br-sm bg-accent/15 px-4 py-2.5 ring-1 ring-accent/20">
        {images.length > 0 ? (
          <div className="mb-3 flex flex-wrap justify-end gap-2">
            {images.map((image, index) => (
              <a
                key={`${image.url}-${index}`}
                href={image.url}
                target="_blank"
                rel="noreferrer"
                className="block overflow-hidden rounded-xl border border-accent/20"
              >
                <img
                  src={image.url}
                  alt={image.fileName ?? "Attached image"}
                  className="max-h-48 max-w-[220px] object-cover"
                />
              </a>
            ))}
          </div>
        ) : null}
        {text ? <p className="whitespace-pre-wrap text-sm leading-relaxed text-text">{text}</p> : null}
      </div>
    </div>
  );
}
