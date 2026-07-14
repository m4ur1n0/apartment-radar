const COOKIE_NAME = "apt-radar-session";
const SESSION_DURATION_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

const enc = new TextEncoder();

async function hmacSign(data: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(data));
  return btoa(String.fromCharCode(...new Uint8Array(sig)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
}

export async function createSessionCookie(secret: string): Promise<string> {
  const expiresAt = Date.now() + SESSION_DURATION_MS;
  const sig = await hmacSign(`${expiresAt}:authenticated`, secret);
  const value = `${expiresAt}:${sig}`;
  const isProd = process.env.NODE_ENV === "production";
  const attrs = [
    `${COOKIE_NAME}=${value}`,
    "HttpOnly",
    "SameSite=Lax",
    "Path=/",
    `Max-Age=${SESSION_DURATION_MS / 1000}`,
    ...(isProd ? ["Secure"] : []),
  ].join("; ");
  return attrs;
}

export function clearSessionCookie(): string {
  return `${COOKIE_NAME}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`;
}

export async function verifySessionCookie(
  cookieHeader: string | null | undefined,
  secret: string
): Promise<boolean> {
  if (!cookieHeader) return false;

  const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${COOKIE_NAME}=([^;]+)`));
  if (!match) return false;

  const raw = match[1];
  const colonIdx = raw.indexOf(":");
  if (colonIdx === -1) return false;

  const expiresAtStr = raw.slice(0, colonIdx);
  const sig = raw.slice(colonIdx + 1);
  const expiresAt = parseInt(expiresAtStr, 10);

  if (isNaN(expiresAt) || Date.now() > expiresAt) return false;

  const expected = await hmacSign(`${expiresAt}:authenticated`, secret);
  return expected === sig;
}

export { COOKIE_NAME };
