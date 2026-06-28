export async function GET() {
  const workerBase = process.env.WORKER_API_BASE_URL;
  if (!workerBase) {
    return Response.json({ error: "missing_server_config" }, { status: 500 });
  }
  const upstream = await fetch(`${workerBase}/listings`, { cache: "no-store" });
  const data = await upstream.json();
  return Response.json(data, { status: upstream.status });
}
