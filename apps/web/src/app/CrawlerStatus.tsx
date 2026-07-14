"use client";

import { useState, useEffect } from "react";

type CrawlerStatusData = {
  crawlerEnabled: boolean;
  pendingImportJobs: number;
  failedImportJobs: number;
  deadImportJobs: number;
  recentRuns: {
    id: string;
    source: string;
    target_id: string;
    status: string;
    started_at: string;
    finished_at: string | null;
    candidates_found: number;
    candidates_accepted: number;
  }[];
};

function fmtTime(iso: string | null | undefined) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString(undefined, {
    month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

export default function CrawlerStatus() {
  const [data, setData] = useState<CrawlerStatusData | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [actionState, setActionState] = useState<"idle" | "loading" | "done">("idle");

  async function load() {
    try {
      const res = await fetch("/api/crawler/status");
      if (!res.ok) { setLoadError(true); return; }
      setData(await res.json());
      setLoadError(false);
    } catch {
      setLoadError(true);
    }
  }

  useEffect(() => { load(); }, []);

  async function runAction(url: string, method = "POST") {
    setActionState("loading");
    try {
      await fetch(url, { method });
      await load();
    } finally {
      setActionState("idle");
    }
  }

  const lastRun = data?.recentRuns?.[0];

  return (
    <div className="border-t border-stone-100 bg-stone-50">
      <div className="max-w-6xl mx-auto px-6 py-4">
        {loadError && (
          <p className="font-mono text-[10px] uppercase tracking-[0.07em] text-red-400">Could not load crawler status</p>
        )}

        {data && (
          <div className="flex flex-wrap items-start gap-x-8 gap-y-3">
            {/* state */}
            <div>
              <span className="font-mono text-[8px] uppercase tracking-[0.12em] text-stone-400 block mb-1">Scheduler</span>
              <div className="flex items-center gap-1.5">
                <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${data.crawlerEnabled ? "bg-emerald-300" : "bg-stone-300"}`} />
                <span className="font-mono text-[10px] uppercase tracking-[0.07em] text-stone-600">
                  {data.crawlerEnabled ? "Active" : "Paused"}
                </span>
              </div>
            </div>

            {/* last run */}
            <div>
              <span className="font-mono text-[8px] uppercase tracking-[0.12em] text-stone-400 block mb-1">Last run</span>
              <span className="font-mono text-[10px] text-stone-600">
                {lastRun ? (
                  <>
                    {fmtTime(lastRun.started_at)}{" "}
                    <span className={
                      lastRun.status === "succeeded" ? "text-emerald-500" :
                      lastRun.status === "failed" ? "text-red-400" : "text-stone-400"
                    }>
                      {lastRun.status}
                    </span>
                    {lastRun.candidates_found > 0 && (
                      <span className="text-stone-400"> · {lastRun.candidates_found} found</span>
                    )}
                  </>
                ) : "—"}
              </span>
            </div>

            {/* import queue */}
            <div>
              <span className="font-mono text-[8px] uppercase tracking-[0.12em] text-stone-400 block mb-1">Import queue</span>
              <span className="font-mono text-[10px] text-stone-600">
                {data.pendingImportJobs} pending
                {(data.failedImportJobs + data.deadImportJobs) > 0 && (
                  <span className="text-red-400"> · {data.failedImportJobs + data.deadImportJobs} failed</span>
                )}
              </span>
            </div>

            {/* actions */}
            <div className="flex items-end gap-2 ml-auto">
              <button
                onClick={() => runAction("/api/crawler/run-once")}
                disabled={actionState === "loading"}
                className="font-mono text-[10px] uppercase tracking-[0.07em] border border-stone-300 px-3 py-1.5 text-stone-600 hover:border-stone-600 hover:text-stone-900 disabled:opacity-40 transition-colors duration-150"
              >
                {actionState === "loading" ? "..." : "Crawl now"}
              </button>
              {data.crawlerEnabled ? (
                <button
                  onClick={() => runAction("/api/crawler/pause")}
                  disabled={actionState === "loading"}
                  className="font-mono text-[10px] uppercase tracking-[0.07em] border border-stone-300 px-3 py-1.5 text-stone-600 hover:border-stone-600 hover:text-stone-900 disabled:opacity-40 transition-colors duration-150"
                >
                  Pause
                </button>
              ) : (
                <button
                  onClick={() => runAction("/api/crawler/resume")}
                  disabled={actionState === "loading"}
                  className="font-mono text-[10px] uppercase tracking-[0.07em] border border-stone-300 px-3 py-1.5 text-stone-600 hover:border-stone-600 hover:text-stone-900 disabled:opacity-40 transition-colors duration-150"
                >
                  Resume
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
