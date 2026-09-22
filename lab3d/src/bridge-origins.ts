/** Exact origins only; the bridge does not enable CORS on the laboratory API. */
export const LOCAL_2D_ORIGINS = [
  "http://127.0.0.1:8766", "http://127.0.0.1:8767",
  "http://localhost:8766", "http://localhost:8767",
] as const;

export function bridgeOrigins(extra = ""): string[] {
  const origins = new Set<string>(LOCAL_2D_ORIGINS);
  for (const value of extra.split(",").map((item) => item.trim()).filter(Boolean)) {
    const url = new URL(value);
    const local = ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);
    if (url.origin !== value || url.username || url.password ||
        !(url.protocol === "https:" || (url.protocol === "http:" && local))) {
      throw new Error("LAB3D_2D_ORIGINS must contain exact HTTPS origins or loopback HTTP origins, separated by commas");
    }
    origins.add(value);
  }
  return [...origins];
}
