// zillow/streeteasy proxy fetches can take up to 25s — set a generous ceiling
export const maxDuration = 60;

export async function POST(request: Request) {
  const workerBase = process.env.WORKER_API_BASE_URL;
  const token = process.env.APT_RADAR_ADMIN_TOKEN;

  if (!workerBase || !token) {
    return Response.json({ error: "missing_server_config" }, { status: 500 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }

  let upstream: Response;
  try {
    upstream = await fetch(`${workerBase}/listings/import-preview`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Admin-Token": token,
      },
      body: JSON.stringify(body),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "upstream unreachable";
    return Response.json({ error: msg }, { status: 502 });
  }

  const text = await upstream.text().catch(() => "");
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return Response.json(
      { error: "upstream_non_json", status: upstream.status },
      { status: 502 }
    );
  }

  return Response.json(data, { status: upstream.status });
}
