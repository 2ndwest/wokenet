/** Camera API transport; the only local proxy is opt-in in a development build. */
export function cameraEndpoint(raw: unknown, development = false): string | null {
  if (raw === "/camera-api" && development) return raw;
  if (typeof raw !== "string" || !raw) return null;
  try {
    const endpoint = new URL(raw);
    if (endpoint.protocol !== "https:" || endpoint.origin !== raw || endpoint.username || endpoint.password) return null;
    return endpoint.origin;
  } catch { return null; }
}

type TokenProvider = () => Promise<string | null>;

export function cameraTransport(endpoint: string, tokenProvider: TokenProvider, lifetime: AbortSignal,
  request: typeof fetch = fetch) {
  return async (path: string, options: RequestInit = {}): Promise<Response> => {
    // Only the viewer's read API may receive a Clerk token. Disallow redirects,
    // alternate origins and path normalization that could escape that API.
    if (!/^\/api\/(?:status|diagnostics|frames|live|frame\/[0-9_-]+)(?:\?[^#\\]*)?$/.test(path)) {
      throw new Error("Invalid camera request");
    }
    const signal = options.signal ? AbortSignal.any([lifetime, options.signal]) : lifetime;
    signal.throwIfAborted();
    let token: string | null;
    try { token = await tokenProvider(); }
    catch {
      signal.throwIfAborted();
      return new Response("Sign in again", { status: 401 });
    }
    // Clerk may finish token refresh after the component/request has gone away.
    signal.throwIfAborted();
    if (!token) return new Response("Not signed in", { status: 401 });
    return request(endpoint + path, {
      method: "GET", headers: { Authorization: `Bearer ${token}` },
      cache: "no-store", credentials: "omit", redirect: "error", signal,
    });
  };
}
