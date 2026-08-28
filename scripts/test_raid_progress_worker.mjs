import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const workerPath = new URL("../workers/cloudflare/blackjack-raid-progress-unified.js", import.meta.url);
const workerSource = readFileSync(workerPath, "utf8");
const workerModule = await import(`data:text/javascript;base64,${Buffer.from(workerSource).toString("base64")}`);
const worker = workerModule.default;

const reportFixtures = {
  season2: {
    code: "SEASON2",
    title: "Ace of Spades - Venomous Abyss",
    startTime: Date.parse("2026-08-23T19:30:00Z"),
    endTime: Date.parse("2026-08-23T21:30:00Z"),
    zone: { id: 999, name: "The Venomous Abyss" },
    fights: [
      { id: 1, name: "Nek'zali the Soulcoiler", kill: true, difficulty: 4, fightPercentage: 0, startTime: 0, endTime: 300000 },
      { id: 2, name: "Entombed Sentinels", kill: false, difficulty: 4, fightPercentage: 37.5, startTime: 310000, endTime: 610000 }
    ]
  },
  sporefall: {
    code: "SPOREFALL",
    title: "Ace of Spades - Sporefall",
    startTime: Date.parse("2026-07-01T19:30:00Z"),
    endTime: Date.parse("2026-07-01T20:00:00Z"),
    zone: { id: 50, name: "Sporefall" },
    fights: [
      { id: 3, name: "Rotmire", kill: true, difficulty: 3, fightPercentage: 0, startTime: 0, endTime: 240000 }
    ]
  }
};

let externalRequests = 0;
let upstreamRateLimited = false;
globalThis.fetch = async (url, options = {}) => {
  externalRequests += 1;

  if (String(url).endsWith("/oauth/token")) {
    return Response.json({ access_token: "test-token" });
  }

  if (!String(url).endsWith("/api/v2/client")) {
    throw new Error(`Unexpected URL: ${url}`);
  }

  if (upstreamRateLimited) {
    return Response.json(
      { error: "Too Many Requests" },
      { status: 429, headers: { "Retry-After": "120" } }
    );
  }

  const request = JSON.parse(options.body);
  if (request.query.includes("c0z0: reports")) {
    return Response.json({
      data: {
        reportData: {
          recentReports: { data: [withoutFights(reportFixtures.season2)] },
          c0z0: { data: [] },
          c1z0: { data: [withoutFights(reportFixtures.sporefall)] },
          c2z0: { data: [] },
          c3z0: { data: [] },
          c4z0: { data: [] },
          c5z0: { data: [] }
        }
      }
    });
  }

  if (request.query.includes("r0: report")) {
    const code = request.variables.code0;
    const report = Object.values(reportFixtures).find(item => item.code === code);
    return Response.json({ data: { reportData: { r0: report || null } } });
  }

  throw new Error("Unexpected GraphQL query");
};

const cacheEntries = new Map();
globalThis.caches = {
  default: {
    async match(request) {
      const response = cacheEntries.get(request.url);
      return response?.clone() || undefined;
    },
    async put(request, response) {
      cacheEntries.set(request.url, response.clone());
    }
  }
};

const env = { WCL_CLIENT_ID: "client", WCL_CLIENT_SECRET: "secret" };

const campaignsResponse = await worker.fetch(new Request("https://worker.test/campaigns"), env);
const campaigns = await campaignsResponse.json();
assert.equal(campaignsResponse.status, 200);
assert.equal(campaigns.currentCampaignId, "midnight-season-2");
assert.equal(campaigns.campaigns.length, 6);

externalRequests = 0;
const dashboardResponse = await worker.fetch(new Request("https://worker.test/progress-dashboard"), env);
const dashboard = await dashboardResponse.json();
assert.equal(dashboardResponse.status, 200);
assert.equal(dashboard.selectedCampaign.id, "midnight-season-2");
assert.equal(dashboard.history.length, 6);
assert.equal(dashboard.progress.heroic.summary.killedBosses, 1);
assert.equal(dashboard.progress.heroic.summary.inProgressBosses, 1);
assert.equal(dashboard.progress.heroic.summary.totalPulls, 2);
assert.equal(dashboard.lastSession.summary.totalKills, 1);
assert.equal(dashboard.lastSession.summary.totalWipes, 1);
assert.equal(dashboard.lastSession.report.code, "SEASON2");
assert.ok(externalRequests <= 3, `Too many mocked external requests: ${externalRequests}`);

externalRequests = 0;
const cachedDashboardResponse = await worker.fetch(new Request("https://worker.test/progress-dashboard"), env);
assert.equal(cachedDashboardResponse.status, 200);
assert.equal(cachedDashboardResponse.headers.get("X-Progress-Cache"), "HIT");
assert.equal(externalRequests, 0, "Fresh cache should avoid Warcraft Logs requests");

for (const key of cacheEntries.keys()) {
  if (key.includes("__progressCache=fresh")) cacheEntries.delete(key);
}
upstreamRateLimited = true;
externalRequests = 0;
const staleDashboardResponse = await worker.fetch(new Request("https://worker.test/progress-dashboard"), env);
const staleDashboard = await staleDashboardResponse.json();
assert.equal(staleDashboardResponse.status, 200);
assert.equal(staleDashboardResponse.headers.get("X-Progress-Cache"), "STALE");
assert.equal(staleDashboard.selectedCampaign.id, "midnight-season-2");
assert.equal(externalRequests, 1, "Stale fallback should follow one failed upstream request");
upstreamRateLimited = false;

externalRequests = 0;
const archiveResponse = await worker.fetch(
  new Request("https://worker.test/progress-dashboard?campaignId=midnight-revelations"),
  env
);
const archive = await archiveResponse.json();
assert.equal(archiveResponse.status, 200);
assert.equal(archive.selectedCampaign.id, "midnight-revelations");
assert.equal(archive.progress.normal.summary.killedBosses, 1);
assert.equal(archive.lastSession.report.code, "SPOREFALL");
assert.ok(externalRequests <= 3, `Too many mocked archive requests: ${externalRequests}`);

console.log("Raid progress Worker tests: OK");

function withoutFights(report) {
  const { fights, ...summary } = report;
  return summary;
}
