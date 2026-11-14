// @summary Shared wait bound for provider response headers

/**
 * Maximum wait for a provider's HTTP response headers. Headers arrive only after the request body is
 * uploaded and the server accepts the request, so long transcripts with images need the same bound
 * as the stream idle timeout rather than a short connect-style limit.
 */
export const PROVIDER_RESPONSE_HEADER_TIMEOUT_MS = 300_000;
