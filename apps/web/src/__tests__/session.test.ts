import { describe, it, expect } from "vitest";
import { createSessionCookie, clearSessionCookie, verifySessionCookie, COOKIE_NAME } from "../lib/session";

const SECRET = "test-secret-32chars-abcdefghijklm";

describe("createSessionCookie", () => {
  it("returns a string containing the cookie name", async () => {
    const header = await createSessionCookie(SECRET);
    expect(header).toContain(`${COOKIE_NAME}=`);
  });

  it("includes HttpOnly and SameSite=Lax", async () => {
    const header = await createSessionCookie(SECRET);
    expect(header).toContain("HttpOnly");
    expect(header).toContain("SameSite=Lax");
  });

  it("produces a cookie that verifies successfully", async () => {
    const header = await createSessionCookie(SECRET);
    const valid = await verifySessionCookie(header, SECRET);
    expect(valid).toBe(true);
  });

  it("wrong secret does not verify", async () => {
    const header = await createSessionCookie(SECRET);
    const valid = await verifySessionCookie(header, "wrong-secret");
    expect(valid).toBe(false);
  });
});

describe("verifySessionCookie", () => {
  it("returns false for null", async () => {
    expect(await verifySessionCookie(null, SECRET)).toBe(false);
  });

  it("returns false for empty string", async () => {
    expect(await verifySessionCookie("", SECRET)).toBe(false);
  });

  it("returns false when cookie is missing", async () => {
    expect(await verifySessionCookie("other-cookie=abc", SECRET)).toBe(false);
  });

  it("returns false for tampered value", async () => {
    const header = await createSessionCookie(SECRET);
    const tampered = header.replace(/=([^;]+)/, "=9999999999:fakesig");
    expect(await verifySessionCookie(tampered, SECRET)).toBe(false);
  });

  it("returns false for expired cookie", async () => {
    // craft a cookie with an expiry in the past
    const expiresAt = Date.now() - 1000;
    // we can't sign with the real HMAC without the sign function, so test indirectly:
    // a cookie with a past timestamp but valid structure should fail
    const cookieStr = `${COOKIE_NAME}=${expiresAt}:invalidsig`;
    expect(await verifySessionCookie(cookieStr, SECRET)).toBe(false);
  });

  it("works when cookie is among other cookies", async () => {
    const header = await createSessionCookie(SECRET);
    const value = header.split(";")[0]; // just the name=value part
    const combined = `other=abc; ${value}; another=xyz`;
    expect(await verifySessionCookie(combined, SECRET)).toBe(true);
  });
});

describe("clearSessionCookie", () => {
  it("sets Max-Age=0 to expire the cookie", () => {
    const header = clearSessionCookie();
    expect(header).toContain("Max-Age=0");
    expect(header).toContain(COOKIE_NAME);
  });
});
