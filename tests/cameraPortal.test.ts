import { describe, expect, it, vi } from "vitest";
import { cameraEndpoint, cameraTransport } from "../src/utils/cameraPortal";

describe("camera portal endpoint boundary", () => {
  it("accepts an exact HTTPS origin", () => {
    expect(cameraEndpoint("https://cameras.example.edu")).toBe("https://cameras.example.edu");
  });
  it("rejects credentials, alternate schemes, paths, queries, fragments and malformed configuration", () => {
    for (const raw of [undefined, "", "http://cameras.example.edu", "https://user:secret@cameras.example.edu",
      "https://cameras.example.edu/", "https://cameras.example.edu/api", "https://cameras.example.edu?key=secret",
      "https://cameras.example.edu#fragment", "//cameras.example.edu", "javascript:alert(1)", "/other-api"])
      expect(cameraEndpoint(raw)).toBeNull();
  });
  it("allows only the exact local proxy prefix in development", () => {
    expect(cameraEndpoint("/camera-api", true)).toBe("/camera-api");
    expect(cameraEndpoint("/camera-api", false)).toBeNull();
    expect(cameraEndpoint("/camera-api/", true)).toBeNull();
    expect(cameraEndpoint("/camera-api?target=https://elsewhere.example", true)).toBeNull();
  });
});

describe("camera portal token transport", () => {
  it("sends each request with a fresh token and no cookies, cache or redirects", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(new Response("ok"));
    const token = vi.fn().mockResolvedValueOnce("first-token").mockResolvedValueOnce("next-token");
    const transport = cameraTransport("https://cameras.example.edu", token, new AbortController().signal, request);
    await transport("/api/status");
    await transport("/api/live?camera=kitchen-1&wait=8");
    expect(token).toHaveBeenCalledTimes(2);
    expect(request.mock.calls[0]).toEqual(["https://cameras.example.edu/api/status", expect.objectContaining({
      method: "GET", headers: { Authorization: "Bearer first-token" }, credentials: "omit", redirect: "error", cache: "no-store",
    })]);
    expect(request.mock.calls[1][1]?.headers).toEqual({ Authorization: "Bearer next-token" });
  });
  it("joins the development proxy to only read-only camera routes", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(new Response("ok"));
    const token = vi.fn().mockResolvedValue("private-token");
    const transport = cameraTransport("/camera-api", token, new AbortController().signal, request);
    await transport("/api/frame/0000001234-0000_5");
    expect(request.mock.calls[0][0]).toBe("/camera-api/api/frame/0000001234-0000_5");
    for (const path of ["https://elsewhere.example/api/status", "//elsewhere.example/api/status", "/api/../admin",
      "/admin", "/api/status#fragment", "/api/status\\escape", "/api/%2e%2e/admin", "/api/frames/extra"])
      await expect(transport(path)).rejects.toThrow("Invalid camera request");
    expect(token).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledTimes(1);
  });
  it("denies a missing or failed Clerk token without contacting the camera", async () => {
    const request = vi.fn<typeof fetch>();
    const transport = cameraTransport("https://cameras.example.edu", vi.fn().mockResolvedValue(null), new AbortController().signal, request);
    expect((await transport("/api/status")).status).toBe(401);
    const failed = cameraTransport("https://cameras.example.edu", vi.fn().mockRejectedValue(Error("token refresh failed")), new AbortController().signal, request);
    expect((await failed("/api/status")).status).toBe(401);
    expect(request).not.toHaveBeenCalled();
  });
  it("does not fetch when a token refresh finishes after unmount", async () => {
    let provide!: (token: string) => void;
    const token = new Promise<string>(resolve => { provide = resolve; });
    const lifetime = new AbortController(), request = vi.fn<typeof fetch>();
    const transport = cameraTransport("https://cameras.example.edu", () => token, lifetime.signal, request);
    const pending = transport("/api/status");
    lifetime.abort();provide("late-token");
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(request).not.toHaveBeenCalled();
  });
  it("does not fetch when an individual request expires during token refresh", async () => {
    let provide!: (token: string) => void;
    const token = new Promise<string>(resolve => { provide = resolve; });
    const current = new AbortController(), request = vi.fn<typeof fetch>();
    const transport = cameraTransport("https://cameras.example.edu", () => token, new AbortController().signal, request);
    const pending = transport("/api/live?camera=kitchen-1", { signal: current.signal });
    current.abort();provide("late-token");
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(request).not.toHaveBeenCalled();
  });
  it("keeps both unmount and individual cancellation attached to an active fetch", async () => {
    const lifetime = new AbortController(), current = new AbortController();
    const request = vi.fn<typeof fetch>().mockImplementation(async (_, options) => {
      const signal = options!.signal!;
      return new Promise<Response>((_, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true }));
    });
    const transport = cameraTransport("https://cameras.example.edu", async () => "token", lifetime.signal, request);
    const pending = transport("/api/status", { signal: current.signal });
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(1));
    lifetime.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  });
});
