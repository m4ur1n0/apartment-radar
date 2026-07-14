export const maxDuration = 60;

export async function POST(request: Request) {
  const workerBase = process.env.WORKER_API_BASE_URL;
  const token = process.env.APT_RADAR_ADMIN_TOKEN;
  if (!workerBase || !token) {
    return Response.json({ error: "missing_server_config" }, { status: 500 });
  }

  let body = {};
  try {
    body = await request.json();
  } catch { /* use defaults */ }

  const upstream = await fetch(`${workerBase}/admin/crawler/run-once`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Admin-Token": token },
    body: JSON.stringify({
      dryRun: false,
      maxDiscoveryTargets: 1,
      maxEnqueueJobs: 10,
      maxImportJobs: 2,
      ...body,
    }),
  });
  const data = await upstream.json();
  return Response.json(data, { status: upstream.status });
}
