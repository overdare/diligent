// @summary Local callback server for interactive OAuth flows
export interface CallbackResult {
  code: string;
  state: string;
}

export function waitForCallback(expectedState: string, timeoutMs = 5 * 60 * 1000): Promise<CallbackResult> {
  return new Promise((resolve, reject) => {
    const server = Bun.serve({
      port: 1455,
      hostname: "localhost",
      fetch(req) {
        const url = new URL(req.url);
        if (url.pathname !== "/auth/callback") {
          return new Response("Not found", { status: 404 });
        }

        const code = url.searchParams.get("code");
        const state = url.searchParams.get("state");
        const error = url.searchParams.get("error");

        if (error) {
          server.stop();
          reject(new Error(`OAuth error: ${error}`));
          return new Response(renderCallbackHtml("Authentication failed."), {
            headers: { "Content-Type": "text/html" },
          });
        }

        if (!code || state !== expectedState) {
          server.stop();
          reject(new Error("Invalid callback: missing code or state mismatch"));
          return new Response(renderCallbackHtml("Invalid callback."), {
            headers: { "Content-Type": "text/html" },
          });
        }

        setTimeout(() => server.stop(), 1000);
        resolve({ code, state });
        return new Response(renderCallbackHtml("Authentication successful! You can close this window."), {
          headers: { "Content-Type": "text/html" },
        });
      },
    });

    setTimeout(() => {
      server.stop();
      reject(new Error("OAuth callback timed out after 5 minutes"));
    }, timeoutMs);
  });
}

function renderCallbackHtml(message: string): string {
  return `<!DOCTYPE html>
<html><head><title>Diligent Auth</title></head>
<body style="font-family:sans-serif;text-align:center;padding:2em">
<h2>${message}</h2></body></html>`;
}
