export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const workerBase = process.env.WORKER_API_BASE_URL;
  const token = process.env.APT_RADAR_ADMIN_TOKEN;
  if (!workerBase || !token) {
    return Response.json({ error: "missing_server_config" }, { status: 500 });
  }

  const { id } = await params;

  let body = {};
  try {
    body = await request.json();
  } catch { /* optional body */ }

  const upstream = await fetch(`${workerBase}/listings/${id}/hide`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Admin-Token": token },
    body: JSON.stringify(body),
  });
  const data = await upstream.json();
  return Response.json(data, { status: upstream.status });
}
