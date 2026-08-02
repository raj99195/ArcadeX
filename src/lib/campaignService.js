// src/lib/campaignService.js
//
// Real service layer for the ArcadeX × BOT Chain campaign portal — every
// function below calls the live /api/campaign endpoints implemented in
// server.js. No mocked data, no artificial delays.

async function apiFetch(url, options = {}) {
  const res = await fetch(url, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || `Request failed (${res.status})`);
  }
  return data;
}

function authHeaders() {
  const token = localStorage.getItem("arcadex_jwt");
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/** GET /api/campaign?action=stats — top-line campaign stats for the landing page */
export async function getCampaign() {
  return apiFetch("/api/campaign?action=stats");
}

/** GET /api/campaign?action=tasks&wallet=... — the ordered task list + current status */
export async function getTasks(walletAddress) {
  if (!walletAddress) return { walletAddress: null, tasks: [] };
  return apiFetch(`/api/campaign?action=tasks&wallet=${walletAddress}`);
}

/** POST /api/campaign?action=verify-social — verify a single social task (follow/join) */
/**
 * POST /api/campaign?action=verify-social — records the username you entered
 * (twitter/telegram/discord) against your wallet for manual review later.
 * There's no automated follow/join check — an admin verifies by hand via the
 * Admin dashboard.
 */
export async function verifySocialTask(taskId, walletAddress, username, field) {
  return apiFetch("/api/campaign?action=verify-social", {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ wallet: walletAddress, taskId, username, field }),
  });
}

/** POST /api/campaign?action=submit-transaction — submit a tx hash for later verification */
export async function submitTransaction(walletAddress, txHash) {
  return apiFetch("/api/campaign?action=submit-transaction", {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ wallet: walletAddress, txHash }),
  });
}

/**
 * POST /api/campaign?action=verify-transaction — validates hash format, wallet,
 * network (must be BOTChain), contract (Platform), and function
 * (recordPlayAndEarn) directly on-chain via the server.
 */
export async function verifyTransaction(walletAddress, txHash) {
  return apiFetch("/api/campaign?action=verify-transaction", {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ wallet: walletAddress, txHash }),
  });
}

/** GET /api/campaign?action=dashboard&wallet=... — the connected user's full campaign progress */
export async function getDashboard(walletAddress) {
  if (!walletAddress) return null;
  return apiFetch(`/api/campaign?action=dashboard&wallet=${walletAddress}`, { headers: authHeaders() });
}

/** GET /api/campaign?action=leaderboard — ranked participants */
export async function getLeaderboard() {
  return apiFetch("/api/campaign?action=leaderboard");
}

/** GET /api/campaign?action=admin — full participant table + aggregate stats (admin only) */
export async function getAdminData() {
  return apiFetch("/api/campaign?action=admin", { headers: authHeaders() });
}

/** POST /api/campaign?action=approve — approve a participant's campaign completion (admin only) */
export async function approveParticipant(wallet) {
  return apiFetch("/api/campaign?action=approve", {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ wallet }),
  });
}

/** POST /api/campaign?action=reject — reject a participant's campaign completion (admin only) */
export async function rejectParticipant(wallet, reason) {
  return apiFetch("/api/campaign?action=reject", {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ wallet, reason }),
  });
}