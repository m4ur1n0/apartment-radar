import { createSessionCookie } from "../../../../lib/session";

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }

  const { password } = (body as { password?: string }) ?? {};
  if (!password || typeof password !== "string") {
    return Response.json({ error: "password_required" }, { status: 400 });
  }

  const sitePassword = process.env.APT_RADAR_SITE_PASSWORD;
  const sessionSecret = process.env.APT_RADAR_SESSION_SECRET;

  if (!sitePassword || !sessionSecret) {
    return Response.json({ error: "server_misconfigured" }, { status: 500 });
  }

  if (password !== sitePassword) {
    return Response.json({ error: "wrong_password" }, { status: 401 });
  }

  const cookieHeader = await createSessionCookie(sessionSecret);
  return Response.json({ ok: true }, {
    headers: { "Set-Cookie": cookieHeader },
  });
}
