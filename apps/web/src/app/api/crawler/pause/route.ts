export async function POST() {
  const workerBase = process.env.WORKER_API_BASE_URL;
  const token = process.env.APT_RADAR_ADMIN_TOKEN;
  if (!workerBase || !token) {
    return Response.json({ error: "missing_server_config" }, { status: 500 });
  }
  const upstream = await fetch(`${workerBase}/admin/crawler/pause`, {
    method: "POST",
    headers: { "X-Admin-Token": token },
  });
  const data = await upstream.json();
  return Response.json(data, { status: upstream.status });
}
