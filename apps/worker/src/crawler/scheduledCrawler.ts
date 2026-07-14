import { SEARCH_TARGETS } from "./searchTargets";
import { discoverListingUrlsForTarget } from "./discovery";
import {
  ensureTargetStateRows,
  getDueDiscoveryTargets,
  markTargetDiscoverySucceeded,
  markTargetDiscoveryFailed,
  getNextDiscoveryAt,
} from "../db/crawlTargetState";
import {
  createCrawlRun,
  finishCrawlRun,
  upsertDiscoveredCandidates,
  type DiscoveredCandidateParams,
} from "../db/crawlDiscovery";
import {
  enqueueImportJobsFromDiscoveredUrls,
  processNextImportJobs,
} from "../db/importJobs";

export type RunCrawlerOptions = {
  mode: "scheduled" | "manual";
  dryRun?: boolean;
  maxDiscoveryTargets?: number;
  maxEnqueueJobs?: number;
  maxImportJobs?: number;
  source?: string;
  scraperApiKeys?: string[];
};

export type RunCrawlerResult = {
  ok: boolean;
  mode: "scheduled" | "manual";
  dryRun: boolean;
  skipped?: boolean;
  skipReason?: string;
  dueTargetsSelected: number;
  discoveryRunsCompleted: number;
  discoveryRunsFailed: number;
  candidatesPersisted: number;
  importJobsInserted: number;
  importJobsProcessed: number;
  importJobsSucceeded: number;
  importJobsFailed: number;
  durationMs: number;
  warnings: string[];
};

type CrawlerEnv = {
  DB: D1Database;
  SCRAPERAPI_KEY?: string;
  SCRAPERAPI_KEY_01?: string;
  SCRAPERAPI_KEY_02?: string;
  SCRAPERAPI_KEY_03?: string;
};

function collectScraperKeys(env: CrawlerEnv): string[] {
  return [
    env.SCRAPERAPI_KEY,
    env.SCRAPERAPI_KEY_01,
    env.SCRAPERAPI_KEY_02,
    env.SCRAPERAPI_KEY_03,
  ].filter(Boolean) as string[];
}

export async function runScheduledCrawler(
  env: CrawlerEnv,
  _ctx: ExecutionContext | undefined,
  options: RunCrawlerOptions
): Promise<RunCrawlerResult> {
  const start = Date.now();
  const {
    mode,
    dryRun = true,
    maxDiscoveryTargets = 2,
    maxEnqueueJobs = 10,
    maxImportJobs = 3,
    source,
  } = options;

  const scraperApiKeys = options.scraperApiKeys ?? collectScraperKeys(env);
  const warnings: string[] = [];
  const db = env.DB;

  // scheduled runs respect the crawler_enabled setting; manual runs always proceed
  if (mode === "scheduled" && !dryRun) {
    const setting = await db
      .prepare("SELECT value FROM app_settings WHERE key = 'crawler_enabled'")
      .first<{ value: string }>();
    if (setting?.value === "false") {
      return {
        ok: true,
        mode,
        dryRun,
        skipped: true,
        skipReason: "crawler_paused",
        dueTargetsSelected: 0,
        discoveryRunsCompleted: 0,
        discoveryRunsFailed: 0,
        candidatesPersisted: 0,
        importJobsInserted: 0,
        importJobsProcessed: 0,
        importJobsSucceeded: 0,
        importJobsFailed: 0,
        durationMs: Date.now() - start,
        warnings: [],
      };
    }
  }

  let dueTargetsSelected = 0;
  let discoveryRunsCompleted = 0;
  let discoveryRunsFailed = 0;
  let candidatesPersisted = 0;
  let importJobsInserted = 0;
  let importJobsProcessed = 0;
  let importJobsSucceeded = 0;
  let importJobsFailed = 0;

  if (dryRun) {
    // read-only preview: just report what would run
    const targets = await getDueDiscoveryTargets(db, {
      limit: maxDiscoveryTargets,
      source,
    });
    dueTargetsSelected = targets.length;
    return {
      ok: true,
      mode,
      dryRun,
      dueTargetsSelected,
      discoveryRunsCompleted: 0,
      discoveryRunsFailed: 0,
      candidatesPersisted: 0,
      importJobsInserted: 0,
      importJobsProcessed: 0,
      importJobsSucceeded: 0,
      importJobsFailed: 0,
      durationMs: Date.now() - start,
      warnings,
    };
  }

  // lazy-seed target state rows for all known targets
  await ensureTargetStateRows(db, SEARCH_TARGETS);

  const dueTargets = await getDueDiscoveryTargets(db, {
    limit: maxDiscoveryTargets,
    source,
  });
  dueTargetsSelected = dueTargets.length;

  for (const targetState of dueTargets) {
    const target = SEARCH_TARGETS.find((t) => t.id === targetState.target_id);
    if (!target) {
      warnings.push(`target ${targetState.target_id} not found in SEARCH_TARGETS`);
      continue;
    }

    const now = new Date();
    const nextAt = getNextDiscoveryAt(target.source, now);

    let runId: string;
    try {
      runId = await createCrawlRun(db, {
        runType: mode,
        source: target.source,
        targetId: target.id,
        targetsRequested: 1,
      });
    } catch (err) {
      const errMsg = String(err);
      warnings.push(`failed to create crawl run for ${target.id}: ${errMsg}`);
      try { await markTargetDiscoveryFailed(db, target.id, errMsg, nextAt); } catch (_) { /* best-effort */ }
      discoveryRunsFailed++;
      continue;
    }

    try {
      const discoveryResult = await discoverListingUrlsForTarget(target, {
        scraperApiKeys,
      });

      const candidateParams: DiscoveredCandidateParams[] = discoveryResult.candidates.map((c) => ({
        source: target.source,
        targetId: target.id,
        crawlRunId: runId,
        listingUrl: c.listingUrl,
        canonicalUrl: c.canonicalUrl ?? c.listingUrl,
        sourceListingId: c.sourceListingId,
        title: c.title,
        price: c.price,
        beds: c.beds,
        baths: c.baths,
        neighborhood: c.neighborhood,
        address: c.address,
        latitude: c.latitude,
        longitude: c.longitude,
        discoveryConfidence: c.confidence,
      }));

      const upsertResult = await upsertDiscoveredCandidates(db, candidateParams);
      candidatesPersisted += upsertResult.inserted + upsertResult.updated;

      await finishCrawlRun(db, runId, {
        status: "succeeded",
        finishedAt: new Date().toISOString(),
        targetsCompleted: 1,
        candidatesFound: discoveryResult.candidatesFound,
        candidatesAccepted: upsertResult.inserted + upsertResult.updated,
        candidatesRejected: discoveryResult.rejected.length,
      });

      await markTargetDiscoverySucceeded(db, target.id, runId, nextAt);
      discoveryRunsCompleted++;
    } catch (err) {
      const errMsg = String(err);
      warnings.push(`discovery failed for ${target.id}: ${errMsg}`);

      try {
        await finishCrawlRun(db, runId, {
          status: "failed",
          finishedAt: new Date().toISOString(),
          targetsCompleted: 0,
          candidatesFound: 0,
          candidatesAccepted: 0,
          candidatesRejected: 0,
          errorMessage: errMsg,
        });
      } catch (_finishErr) {
        // best-effort
      }

      await markTargetDiscoveryFailed(db, target.id, errMsg, nextAt);
      discoveryRunsFailed++;
    }
  }

  // enqueue import jobs from newly discovered URLs
  if (maxEnqueueJobs > 0) {
    try {
      const enqueueResult = await enqueueImportJobsFromDiscoveredUrls(db, {
        limit: maxEnqueueJobs,
        source,
        dryRun: false,
      });
      importJobsInserted = enqueueResult.insertedJobs;
    } catch (err) {
      warnings.push(`enqueue failed: ${String(err)}`);
    }
  }

  // process next import jobs
  if (maxImportJobs > 0) {
    try {
      const processResult = await processNextImportJobs(db, {
        limit: maxImportJobs,
        source,
        dryRun: false,
        scraperApiKeys,
      });
      importJobsProcessed = processResult.processedJobs;
      importJobsSucceeded = processResult.succeeded;
      importJobsFailed = processResult.failed + processResult.dead;
    } catch (err) {
      warnings.push(`import processing failed: ${String(err)}`);
    }
  }

  return {
    ok: true,
    mode,
    dryRun,
    dueTargetsSelected,
    discoveryRunsCompleted,
    discoveryRunsFailed,
    candidatesPersisted,
    importJobsInserted,
    importJobsProcessed,
    importJobsSucceeded,
    importJobsFailed,
    durationMs: Date.now() - start,
    warnings,
  };
}
