// middleware already guards this route; if we reach here the session is valid
export async function GET() {
  return Response.json({ ok: true });
}
