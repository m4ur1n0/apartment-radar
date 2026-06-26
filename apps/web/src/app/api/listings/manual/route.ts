export async function POST(request: Request) {
  const workerBase = process.env.WORKER_API_BASE_URL;
  const token = process.env.APT_RADAR_ADMIN_TOKEN;

  if (!workerBase || !token) {
    return Response.json({ error: "missing_server_config" }, { status: 500 });
  }

  const body = await request.json();

  const upstream = await fetch(`${workerBase}/listings/manual`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Admin-Token": token,
    },
    body: JSON.stringify(body),
  });

  const data = await upstream.json();
  return Response.json(data, { status: upstream.status });
}
