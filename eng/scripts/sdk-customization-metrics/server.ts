// Serves the published dashboard and the review API.
//
// In Azure this runs on App Service behind its built-in sign-in (Easy Auth), which removes any
// client-sent X-MS-CLIENT-PRINCIPAL-* headers and sets them for signed-in users; only then are
// those headers trusted. Locally, `cli.ts serve --dev-user NAME` signs everyone in as NAME and
// emulates the /.auth endpoints the page uses.
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize, resolve, sep } from "node:path";
import { canReview, handleReviews, type Principal, type ReviewStore } from "./reviews.ts";

export interface ServerOptions {
  siteDirectory: string;
  store: ReviewStore;
  reviewers: string[];
  // Trust App Service sign-in headers (set only when App Service authentication is on).
  trustAuthHeaders?: boolean;
  // Local development: treat every request as signed in as this user.
  devUser?: string;
}

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
  ".db": "application/octet-stream",
};

const SECURITY_HEADERS = {
  "x-content-type-options": "nosniff",
  "referrer-policy": "same-origin",
  "x-frame-options": "DENY",
};

function send(response: ServerResponse, status: number, body: unknown, type?: string): void {
  const text = typeof body === "string" || Buffer.isBuffer(body) ? body : JSON.stringify(body);
  response.writeHead(status, {
    ...SECURITY_HEADERS,
    "content-type": type ?? "application/json; charset=utf-8",
    "cache-control": type ? "public, max-age=300" : "no-store",
  });
  response.end(text);
}

function principalOf(request: IncomingMessage, options: ServerOptions): Principal | null {
  if (options.devUser) return { id: options.devUser, name: options.devUser, provider: "dev" };
  if (!options.trustAuthHeaders) return null;
  const name = request.headers["x-ms-client-principal-name"];
  const id = request.headers["x-ms-client-principal-id"];
  const provider = request.headers["x-ms-client-principal-idp"];
  if (typeof name !== "string" || typeof id !== "string" || !name || !id) return null;
  return { id, name, provider: typeof provider === "string" ? provider : "" };
}

async function body(request: IncomingMessage, limit = 128 * 1024): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    size += (chunk as Buffer).length;
    if (size > limit) throw new Error("Request too large");
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function serveFile(response: ServerResponse, root: string, pathname: string): Promise<void> {
  let relative: string;
  try {
    relative = decodeURIComponent(pathname);
  } catch {
    return send(response, 400, { error: "Bad path" });
  }
  let file = normalize(join(root, relative));
  if (file !== root && !file.startsWith(root + sep))
    return send(response, 404, "Not found", "text/plain");
  try {
    if ((await stat(file)).isDirectory()) file = join(file, "index.html");
    send(response, 200, await readFile(file), TYPES[extname(file)] ?? "application/octet-stream");
  } catch {
    send(response, 404, "Not found", "text/plain; charset=utf-8");
  }
}

export function createReviewServer(options: ServerOptions): Server {
  const root = resolve(options.siteDirectory);
  return createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? "/", "http://localhost");
      const principal = principalOf(request, options);
      if (url.pathname === "/healthz") return send(response, 200, { ok: true });
      if (url.pathname === "/api/reviews") {
        const result = await handleReviews(
          {
            method: request.method ?? "GET",
            body: request.method === "POST" ? await body(request) : undefined,
            principal,
            origin: request.headers.origin,
            host: request.headers.host,
            contentType: request.headers["content-type"],
          },
          options,
        );
        return send(response, result.status, result.body);
      }
      if (url.pathname === "/api/me")
        return send(response, 200, {
          signedIn: Boolean(principal),
          name: principal?.name ?? "",
          // Lets the page say "not a reviewer" before anyone types a review.
          reviewer: canReview(principal, options.reviewers),
        });
      if (options.devUser && url.pathname.startsWith("/.auth/")) {
        // App Service handles these in Azure; locally, signing in and out just returns.
        const next = url.searchParams.get("post_login_redirect_uri") ?? "/";
        response.writeHead(302, { location: next.startsWith("/") ? next : "/" });
        return response.end();
      }
      if (request.method !== "GET" && request.method !== "HEAD")
        return send(response, 405, { error: "Method not allowed" });
      return serveFile(response, root, url.pathname);
    } catch (error) {
      // Details go to the log (App Service log stream), not to the browser.
      console.error(error);
      send(response, 500, { error: "Server error; see the service log" });
    }
  });
}
