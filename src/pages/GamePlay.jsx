import { useParams, useNavigate, useLocation } from "react-router-dom";
import { useEffect, useState, useRef, useCallback, memo, forwardRef } from "react";
import { useAccount, usePublicClient, useWalletClient } from "wagmi";
import { writeContract, waitForTransactionReceipt, readContract } from "@wagmi/core";
import { keccak256, toHex } from "viem";
import { wagmiAdapter } from "../Providers";
import { useGames, bustGamesCache } from "../hooks/useGames";
import { saveScore } from "../lib/gameService";
import { useChain } from "../context/ChainContext";
import { getActiveAvatarStyle } from "../utils/avatarUtils";
import { useArcadeBalance } from "../hooks/useArcadeBalance";
import { signInAndGetJwt, hasValidJwtForWallet } from "../hooks/useAutoAuth";
import { useTurnstile } from "../context/TurnstileContext";
import Seo from "../components/Seo";

const TOURNAMENT_SCORE_ABI = [{ name: "submitTournamentScore", type: "function", stateMutability: "nonpayable", inputs: [{ name: "tournamentId", type: "uint256" }, { name: "score", type: "uint256" }, { name: "nonce", type: "uint256" }, { name: "signature", type: "bytes" }], outputs: [] }];
const PLATFORM_ABI = [{ name: "recordPlayAndEarn", type: "function", stateMutability: "nonpayable", inputs: [{ name: "gameId", type: "uint256" }, { name: "score", type: "uint256" }, { name: "nonce", type: "uint256" }, { name: "signature", type: "bytes" }], outputs: [] }];
const PLATFORM_READ_ABI = [
  { name: "games", type: "function", stateMutability: "view", inputs: [{ name: "", type: "uint256" }], outputs: [{ name: "gameId", type: "uint256" }, { name: "name", type: "string" }, { name: "creator", type: "address" }, { name: "iframeUrl", type: "string" }, { name: "rewardRate", type: "uint256" }, { name: "totalPlays", type: "uint256" }, { name: "isActive", type: "bool" }] },
  { name: "playerSharePercent", type: "function", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint256" }] },
  { name: "creatorSharePercent", type: "function", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint256" }] },
  { name: "gameMinScore", type: "function", stateMutability: "view", inputs: [{ name: "", type: "uint256" }], outputs: [{ name: "", type: "uint256" }] },
];

// ── ArcadeX SDK: GameItems (ERC-1155 — skins + power-ups, no registry) ──
const GAME_ITEMS_ABI = [
  { name: "purchaseSkinAndMint", type: "function", stateMutability: "payable", inputs: [{ name: "gameId", type: "uint256" }, { name: "skinIndex", type: "uint256" }, { name: "name", type: "string" }, { name: "imageURI", type: "string" }, { name: "price", type: "uint256" }, { name: "creator", type: "address" }], outputs: [{ name: "tokenId", type: "uint256" }] },
  { name: "purchasePowerUp", type: "function", stateMutability: "payable", inputs: [{ name: "gameId", type: "uint256" }, { name: "powerUpId", type: "string" }, { name: "price", type: "uint256" }, { name: "creator", type: "address" }], outputs: [] },
];
const ERC20_ABI = [
  { name: "approve", type: "function", stateMutability: "nonpayable", inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }], outputs: [{ name: "", type: "bool" }] },
  { name: "allowance", type: "function", stateMutability: "view", inputs: [{ name: "owner", type: "address" }, { name: "spender", type: "address" }], outputs: [{ name: "", type: "uint256" }] },
];

// ── ClashPot Escrow ABI ────────────────────────────────────────────────────
const CLASHPOT_ESCROW_ABI = [
  {
    name: "join",
    type: "function",
    stateMutability: "payable",
    inputs: [{ name: "matchId", type: "bytes32" }],
    outputs: []
  }
];

// SkinPurchased(address indexed player, uint256 indexed tokenId, uint256 indexed gameId, uint256 skinIndex, uint256 price)
// 3 indexed params -> topics.length === 4. Used to pull the minted tokenId out of the receipt
// without needing the exact keccak topic0 hash.
function extractSkinTokenId(receipt, gameItemsAddress) {
  try {
    const log = receipt.logs.find(
      (l) => l.address?.toLowerCase() === gameItemsAddress?.toLowerCase() && l.topics.length === 4
    );
    return log ? BigInt(log.topics[2]).toString() : null;
  } catch {
    return null;
  }
}

const C = {
  bg: "#08070f", card: "#0d0b1a", card2: "#12102a",
  border: "rgba(123,47,255,0.14)", border2: "rgba(123,47,255,0.25)",
  purple: "#7B2FFF", purpleL: "#B088FF", cyan: "#00D4FF",
  green: "#00FF88", gold: "#FFB700", dim: "#9977CC", dimMore: "#5533AA",
  raj: "'Rajdhani', sans-serif", orb: "'Orbitron', sans-serif",
};

function timeAgo(date) {
  if (!date) return "";
  const d = date?.toDate ? date.toDate() : new Date(date);
  const diff = (Date.now() - d) / 1000;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function DiceBearAvatar({ address, style, size = 28 }) {
  const s = style || getActiveAvatarStyle(address);
  return (
    <div style={{ width: size, height: size, borderRadius: "50%", overflow: "hidden", border: "1.5px solid rgba(123,47,255,0.4)", flexShrink: 0, background: "#0e0c1a" }}>
      <img src={`https://api.dicebear.com/9.x/${s}/svg?seed=${address}`} alt="" style={{ width: "100%", height: "100%" }} />
    </div>
  );
}

// Memoized game frame — the iframe lives here so the parent's frequent post-load
// re-renders (stats, comments, likes, splits) never touch the iframe DOM node.
// On iOS Safari, re-inserting an iframe during reconciliation reloads it, which
// is what caused the 2-3 restarts; memo + a single stable element stops that.
// Fullscreen restyles THIS same element instead of mounting a second iframe.
const GameFrame = memo(forwardRef(function GameFrame({ url, title, isMobile, isFullscreen, onToggleFullscreen }, ref) {
  // Fake-FS container: `inset: 0` is viewport-relative so it survives iOS
  // Safari's address-bar collapse. No `transform` on any ancestor (checked)
  // so fixed positioning holds. `env(safe-area-inset-*)` keeps the game
  // canvas away from the notch/dynamic-island on iPhone and the status bar
  // on Android — otherwise the top of the game clips under the notch.
  const containerStyle = isFullscreen
    ? {
        position: "fixed", inset: 0, zIndex: 9999, background: "#000",
        display: "flex", flexDirection: "column",
        paddingTop: "env(safe-area-inset-top, 0px)",
        paddingBottom: "env(safe-area-inset-bottom, 0px)",
        paddingLeft: "env(safe-area-inset-left, 0px)",
        paddingRight: "env(safe-area-inset-right, 0px)",
      }
    : { position: "relative" };
  const iframeStyle = isFullscreen
    ? { flex: 1, width: "100%", border: "none", display: "block" }
    : { width: "100%", height: isMobile ? "75vw" : "calc(100vh - 54px - 160px)", minHeight: isMobile ? 300 : 480, border: "none", display: "block" };
  const btnBase = { padding: "6px 12px", background: "rgba(0,0,0,0.8)", border: `1px solid ${C.border2}`, borderRadius: 7, color: "#a67fff", fontSize: 11, cursor: "pointer", fontFamily: C.raj, fontWeight: 700, backdropFilter: "blur(8px)", display: "flex", alignItems: "center", gap: 5 };
  // Exit button in fake-FS: bigger tap target on mobile + safe-area top offset
  // so it doesn't sit under the notch. Native FS on desktop uses the same
  // absolute position — no notch to worry about there.
  const exitBtnStyle = isFullscreen
    ? {
        ...btnBase,
        position: "absolute",
        top: `calc(12px + env(safe-area-inset-top, 0px))`,
        right: `calc(12px + env(safe-area-inset-right, 0px))`,
        zIndex: 10000,
        padding: isMobile ? "10px 16px" : "6px 12px",
        fontSize: isMobile ? 13 : 11,
      }
    : { ...btnBase, position: "absolute", bottom: 10, right: 10 };
  return (
    <div style={containerStyle}>
      <iframe ref={ref} src={url}
        style={iframeStyle}
        allow="fullscreen; autoplay; gyroscope; accelerometer" allowFullScreen title={title} />
      <button onClick={onToggleFullscreen} style={exitBtnStyle}>
        <span>{isFullscreen ? "✕" : "⛶"}</span> {isFullscreen ? "Exit" : "Fullscreen"}
      </button>
    </div>
  );
}));


export default function GamePlay() {
  const { gameId } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const searchParams = new URLSearchParams(location.search);
  const tournamentId = searchParams.get("tournamentId");
  const [isMobile, setIsMobile] = useState(window.innerWidth <= 768);

  const { games } = useGames();
  const game = games.find(g => g.id === Number(gameId));
  const { chainKey, contracts, explorerUrl, chainName, chainId, rewardToken, isNativeToken } = useChain();
  const PLATFORM_ADDRESS = contracts?.platform;
  const TOURNAMENT_ADDRESS = contracts?.tournament;
  const GAME_ITEMS_ADDRESS = contracts?.gameItems;
  const ESCROW_ADDRESS = contracts?.clashpotEscrow || import.meta.env.VITE_CLASHPOT_ESCROW_ADDRESS;
  const ERC20_TOKEN_ADDRESS = contracts?.token; // ARCADE token on BOTChain, unused when isNativeToken
  const CHAIN_ID = chainId;
  const rewardSymbol = rewardToken || "ARCADE";
  const { address, isConnected } = useAccount();
  const publicClient = usePublicClient();
  // walletClient chahiye kyunki submitScore ke andar agar JWT missing/expired
  // ho toh signInAndGetJwt() call karna hai — wo walletClient.signMessage
  // ka fallback use karta hai jab window.ethereum available na ho (rare, but
  // WalletConnect-only flows me hota hai).
  const { data: walletClient } = useWalletClient();
  // Turnstile token provider — cheap invisible verification wrapping every
  // sign-in call. getTurnstileToken() returns cached or fresh token; used
  // by signInAndGetJwt below when we do inline auth-on-submit.
  const { getToken: getTurnstileToken } = useTurnstile();

  const [score, setScore] = useState(0);
  // SH0036 — MST team request: "score resets to 0 after every claim; next
  // claim needs another 500 fresh points from reset". Frontend-side fix
  // (SDK/game-side reset baad mein weekend pe). Design:
  //   • `rawGameScore` = actual cumulative game score (from iframe SCORE_UPDATE)
  //   • `scoreBaseline` = last submitted score (persisted per wallet+game)
  //   • `score` (displayed) = rawGameScore - scoreBaseline
  //   • Submit blocks if displayed score < minScore
  //   • After success, baseline updates to raw → display resets to 0
  //   • Game restart (raw < baseline) → baseline resets to 0
  const [rawGameScore, setRawGameScore] = useState(0);
  const [scoreBaseline, setScoreBaseline] = useState(0);
  // SH0037 — refs for values that submitScore reads. The message-listener
  // useEffect deps only includes a subset of state (address, game, submitted,
  // chainId, contracts, isNativeToken) to avoid churning the listener on every
  // score tick. But submitScore captured in that closure was reading STALE
  // playerSplit (default 80), stale minScore, stale rawGameScore, etc. Result:
  //   • Sidebar "You earn" showed +0.5 (correct, from latest render)
  //   • Success overlay "earned!" showed +0.4 (stale closure with playerSplit=80)
  //   • MST minScore gate could bypass with old value
  // Fix: keep listener deps minimal, refs sync latest on every render, and
  // submitScore reads *from refs* — always current, no listener re-registration.
  const playerSplitRef   = useRef(80);
  const minScoreRef      = useRef(null);
  const rawGameScoreRef  = useRef(0);
  const scoreBaselineRef = useRef(0);
  const [showHelpModal, setShowHelpModal] = useState(false);
  const [isFakeFullscreen, setIsFakeFullscreen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [txHash, setTxHash] = useState("");
  const [submitError, setSubmitError] = useState(null); // null | { type, icon, title, msg }
  // Score submission overlay stage — drives the full-screen modal that
  // shows the user WHAT'S HAPPENING at every step. Prior to this, the
  // only feedback was a tiny "Writing on chain…" text under the game;
  // mobile users routinely abandoned mid-flow because they didn't know
  // a wallet popup was even coming. Stages:
  //   auth       → asking wallet to sign the free JWT challenge
  //   session    → fetching one-time gameplay session token
  //   signing    → backend is signing the score (ECDSA)
  //   wallet     → waiting for user to approve tx in wallet
  //   confirming → tx broadcast, waiting for on-chain receipt
  //   success    → done — auto-dismisses after 2.5s
  const [submitStage, setSubmitStage] = useState(null);
  // ── TaskOn polling state ────────────────────────────────────────
  // Full-screen overlay when the wallet hasn't completed the TaskOn
  // campaign yet. Backend is polled every 2s; on completion we resume
  // the submission using the ORIGINAL jwt + session (not re-issued),
  // so playSec at sign-score reflects the real gameplay time plus the
  // TaskOn wait — GATE 1 passes easily.
  //   taskonPolling = null | { campaignUrl, startedAt }
  const [taskonPolling, setTaskonPolling] = useState(null);
  const taskonPollTimerRef    = useRef(null);
  const taskonCancelledRef    = useRef(false);
  const taskonResumeStateRef  = useRef(null); // { jwt, session, finalScore }
  const taskonStartTimeRef    = useRef(0);
  const [taskonElapsed, setTaskonElapsed] = useState(0); // seconds — for UI counter
  const [gameLoading, setGameLoading] = useState(true);
  const [tokensEarned, setTokensEarned] = useState(0);
  const [totalPlays, setTotalPlays] = useState(0);
  const [uniquePlayers, setUniquePlayers] = useState(0);
  const [creatorProfile, setCreatorProfile] = useState(null);
  const [liked, setLiked] = useState(false);
  const [likeCount, setLikeCount] = useState(0);
  const [playerSplit, setPlayerSplit] = useState(80);
  const [creatorSplit, setCreatorSplit] = useState(20);
  const [minScore, setMinScore] = useState(null);   // admin-set per-game min score to earn
  const [comments, setComments] = useState([]);
  const [commentText, setCommentText] = useState("");
  const [postingComment, setPostingComment] = useState(false);
  const [commentsLoading, setCommentsLoading] = useState(true);

  const iframeRef = useRef(null);
  const submittingRef = useRef(false);
  const sessionTokenRef = useRef(null); // SH0009: gameplay session token
  const { balance } = useArcadeBalance();

  // SH0003: fullscreen — reality of shipping this cross-platform:
  //   • Desktop Chrome/Firefox/Safari → iframe.requestFullscreen() works.
  //   • iOS Safari → iframe FS is fully blocked by WebKit (no debate).
  //   • Android Chrome → mostly works, but flaky on some OEM browsers.
  //   • MetaMask browser, Trust, Coinbase Wallet, Instagram/FB in-app,
  //     Telegram in-app → Fullscreen API is either stripped OR rejects
  //     the promise silently. Ritik's screenshot = MetaMask browser.
  //
  // Old bug: nativeFS.call(iframe) returns a Promise. If it rejects async
  // (which is exactly what MM browser does), the try/catch NEVER fires
  // because it only catches sync throws → fake-FS fallback never ran →
  // "Fullscreen" button appeared dead. This is the reported bug.
  //
  // New strategy: on mobile ALWAYS use fake FS (a CSS `position:fixed`
  // overlay). It works in every mobile browser + in-app wallet browser
  // ever shipped. On desktop try native first, catch the promise reject,
  // fall back to fake. document.fullscreenchange keeps the state honest
  // when the user hits ESC or the Android back button.
  const [isNativeFullscreen, setIsNativeFullscreen] = useState(false);
  const isFullscreen = isNativeFullscreen || isFakeFullscreen;

  useEffect(() => {
    const onFsChange = () => {
      const fsEl = document.fullscreenElement || document.webkitFullscreenElement;
      setIsNativeFullscreen(!!fsEl);
    };
    document.addEventListener("fullscreenchange", onFsChange);
    document.addEventListener("webkitfullscreenchange", onFsChange);
    return () => {
      document.removeEventListener("fullscreenchange", onFsChange);
      document.removeEventListener("webkitfullscreenchange", onFsChange);
    };
  }, []);

  // Body-scroll lock during fake FS. Without this, iOS Safari lets you
  // rubber-band-scroll behind the overlay and stray touches can slip past
  // the game canvas edges.
  useEffect(() => {
    if (!isFakeFullscreen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [isFakeFullscreen]);

  // Stable identity (refs + setters + isMobile only). Deps intentionally
  // exclude isFakeFullscreen — we read the latest value from setter callback.
  const handleToggleFullscreen = useCallback(() => {
    // Already in native FS? Exit natively.
    const fsEl = document.fullscreenElement || document.webkitFullscreenElement;
    if (fsEl) {
      const exit = document.exitFullscreen || document.webkitExitFullscreen;
      try { exit?.call(document); } catch { /* no-op */ }
      return;
    }
    // Already in fake FS? Exit.
    if (isFakeFullscreen) { setIsFakeFullscreen(false); return; }

    // Mobile → straight to fake FS. Skip the native attempt entirely —
    // MetaMask/Trust/Coinbase in-app browsers reject it silently and
    // there's no reliable UA sniff for "am I in an in-app browser".
    if (isMobile) { setIsFakeFullscreen(true); return; }

    // Desktop → try native FS on iframe, fall back to fake if the
    // browser rejects (some Firefox configs, embedded browsers, etc.)
    const iframe = iframeRef.current;
    const nativeFS = iframe?.requestFullscreen || iframe?.webkitRequestFullscreen;
    if (!nativeFS) { setIsFakeFullscreen(true); return; }
    try {
      const p = nativeFS.call(iframe);
      if (p && typeof p.then === "function") {
        p.catch(() => setIsFakeFullscreen(true)); // ← the fix
      }
    } catch {
      setIsFakeFullscreen(true);
    }
  }, [isMobile, isFakeFullscreen]);

  useEffect(() => {
    const h = () => setIsMobile(window.innerWidth <= 768);
    window.addEventListener("resize", h);
    return () => window.removeEventListener("resize", h);
  }, []);

  // SH0003: ESC exits fake fullscreen (desktop convenience — native FS
  // already exits on ESC by the browser itself).
  useEffect(() => {
    if (!isFakeFullscreen) return;
    const onKey = (e) => { if (e.key === "Escape") setIsFakeFullscreen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isFakeFullscreen]);

  useEffect(() => {
    if (games.length > 0) setGameLoading(false);
  }, [games]);

  useEffect(() => { if (game) setLikeCount(game.likes || 0); }, [game]);

  // SH0037 — keep refs in sync with state so submitScore always reads latest
  // (see ref declarations above for full explanation of the closure bug).
  useEffect(() => { playerSplitRef.current   = playerSplit;   }, [playerSplit]);
  useEffect(() => { minScoreRef.current      = minScore;      }, [minScore]);
  useEffect(() => { rawGameScoreRef.current  = rawGameScore;  }, [rawGameScore]);
  useEffect(() => { scoreBaselineRef.current = scoreBaseline; }, [scoreBaseline]);

  // SH0036 — load persisted score baseline for THIS game+wallet from
  // localStorage. Ensures baseline survives page reloads (user submits,
  // closes tab, comes back → next play starts from where they left off,
  // not accumulated old score). Cleared on wallet-switch (different key).
  useEffect(() => {
    if (!game?.id || !address) {
      setScoreBaseline(0);
      setRawGameScore(0);
      setScore(0);
      return;
    }
    try {
      const key = `arcadex_score_baseline_${address.toLowerCase()}_${game.id}`;
      const stored = localStorage.getItem(key);
      const baseline = stored ? Number(stored) || 0 : 0;
      setScoreBaseline(baseline);
    } catch { setScoreBaseline(0); }
    // Reset display state — fresh game session view
    setRawGameScore(0);
    setScore(0);
  }, [game?.id, address]);

  // Fetch on-chain reward split so UI reflects what admin set
  useEffect(() => {
    if (!PLATFORM_ADDRESS || !publicClient) return;
    (async () => {
      try {
        const [pct, cPct] = await Promise.all([
          publicClient.readContract({ address: PLATFORM_ADDRESS, abi: PLATFORM_READ_ABI, functionName: "playerSharePercent" }),
          publicClient.readContract({ address: PLATFORM_ADDRESS, abi: PLATFORM_READ_ABI, functionName: "creatorSharePercent" }),
        ]);
        setPlayerSplit(Number(pct));
        setCreatorSplit(Number(cPct));
      } catch (err) {
        console.warn("Could not fetch reward split, using defaults:", err.message);
      }
      // Per-game minimum score to earn a reward (admin sets it in AdminMST →
      // setGameMinScore on-chain). Separate try so a miss here doesn't block splits.
      if (gameId != null) {
        try {
          const ms = await publicClient.readContract({ address: PLATFORM_ADDRESS, abi: PLATFORM_READ_ABI, functionName: "gameMinScore", args: [BigInt(gameId)] });
          setMinScore(Number(ms));
        } catch (_) {}
      }
    })();
  }, [PLATFORM_ADDRESS, publicClient, gameId]);

  useEffect(() => {
    if (!gameId || !address) return;
    setLiked(!!localStorage.getItem(`liked_game_${gameId}_${address}`));
  }, [gameId, address]);

  // Fetch game stats via API
  // SH0035 — stats + comments split into 2 parallel fetches. Backend
  // `stats` action returns only counts (plays/likes/uniquePlayers) now —
  // comments moved to dedicated `comments` action. Parallel fetch means
  // no perceived slowdown for the user (both start together), but the
  // backend can cache each independently and comments-fetch skips entirely
  // for users who never scroll to comments (~70% of traffic).
  useEffect(() => {
    if (!game) return;
    const gid = game.gameId || game.id;
    // Stats — fast, small payload, 3-min Edge cache
    (async () => {
      try {
        const res = await fetch(`/api/games?action=stats&gameId=${gid}`);
        const data = await res.json();
        setTotalPlays(data.plays || 0);
        setUniquePlayers(data.uniquePlayers || 0);
      } catch (e) { /* silent */ }
    })();
    // Comments — parallel, 2-min Edge cache
    (async () => {
      try {
        const res = await fetch(`/api/games?action=comments&gameId=${gid}&limit=50`);
        const data = await res.json();
        setComments(data.comments || []);
      } catch (e) { /* silent */ }
      finally { setCommentsLoading(false); }
    })();
  }, [game?.id]);

  // Fetch creator via API
  useEffect(() => {
    if (!game?.creator) return;
    const fetchCreator = async () => {
      try {
        const res = await fetch(`/api/creators?address=${game.creator}`);
        const data = await res.json();
        if (data) setCreatorProfile(data);
      } catch (e) {}
    };
    fetchCreator();
  }, [game?.creator]);

  // Track play + start gameplay session (SH0009)
  useEffect(() => {
    if (!game || !address || gameLoading) return;
    const trackPlay = async () => {
      try {
        const token = localStorage.getItem("arcadex_jwt");
        await fetch("/api/games?action=play", {
          method: "POST",
          headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
          body: JSON.stringify({ gameId: game.gameId || game.id }),
        });
        setTotalPlays(p => p + 1);
      } catch (e) {}
    };

    // SH0009: one-time session token — bina is token ke sign-score nahi milega
    const startSession = async () => {
      try {
        const token = localStorage.getItem("arcadex_jwt");
        if (!token) return;
        const res = await fetch("/api/games?action=start-session", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ gameId: game.gameId || game.id, chain: chainKey }),
        });
        if (res.ok) {
          const { sessionToken } = await res.json();
          sessionTokenRef.current = sessionToken;
          console.log("[session] started:", sessionToken?.slice(0, 8) + "...");
        }
      } catch (e) { console.warn("[session] start failed:", e); }
    };

    trackPlay();
    startSession();
  }, [game?.id, address, gameLoading]);

  // ── ArcadeX SDK: postMessage helper (GamePlay -> game iframe) ──
  // SH0005 + SH0016: targetOrigin = game's actual origin, never "*".
  // Agar origin resolve na ho toh send skip karo (fail-closed) — kabhi "*"
  // pe sensitive data (player info) leak nahi hone dena.
  const getGameOrigin = () => {
    try {
      if (game?.iframeUrl) return new URL(game.iframeUrl, window.location.origin).origin;
    } catch { /* fallthrough */ }
    return null;
  };
  const sendToGame = (type, payload) => {
    const origin = getGameOrigin();
    if (!origin) return; // origin pata nahi → mat bhejo
    iframeRef.current?.contentWindow?.postMessage({ type, _platform: true, ...payload }, origin);
  };

  // ── Contract error → professional message mapper ──────────────────────────
  // Maps Platform.sol require() strings + wallet errors to clean user-facing
  // objects. NEVER shows raw blockchain error text to the player.
  // type: "soft" errors are shown in gold (player can fix), "hard" in red (admin issue).
  const parseContractError = (err) => {
    const raw = (err?.shortMessage || err?.message || "").toLowerCase();

    // Player cancelled wallet prompt
    if (/user rejected|user denied|cancelled|rejected the request/i.test(raw))
      return { type: "cancelled", soft: true, icon: "✕", title: "Transaction Cancelled", msg: "You cancelled the wallet request. Hit Submit Score again whenever you're ready." };

    // Platform.sol: minSecondsBetweenPlays throttle
    if (raw.includes("playing too fast"))
      return { type: "cooldown", soft: true, icon: "⏱", title: "Slow Down!", msg: "You're submitting scores too quickly. Wait a moment before trying again." };

    // Platform.sol: per-player daily cap
    if (raw.includes("daily player cap reached"))
      return { type: "cap", soft: true, icon: "🏆", title: "Daily Earning Limit Reached", msg: `You've earned the maximum ${rewardSymbol} allowed for today. Come back tomorrow to keep playing!` };

    // Platform.sol: chain-wide daily cap
    if (raw.includes("daily chain cap reached"))
      return { type: "cap", soft: true, icon: "🌐", title: "Platform Daily Cap Reached", msg: "The platform's daily reward pool has been exhausted. Rewards will reset tomorrow — your score still counts!" };

    // Platform.sol: gameMinScore check
    if (raw.includes("score below minimum"))
      return { type: "minscore", soft: true, icon: "📊", title: "Score Too Low", msg: "Your score didn't meet the minimum requirement for this game. Play again and aim higher!" };

    // Platform.sol: nonce replay protection
    if (raw.includes("score proof already used"))
      return { type: "duplicate", soft: true, icon: "⚠️", title: "Already Submitted", msg: "This score has already been recorded on-chain. Play a new round to earn more rewards." };

    // Platform.sol: ECDSA signature mismatch
    if (raw.includes("invalid score proof"))
      return { type: "proof", soft: false, icon: "🔐", title: "Score Verification Failed", msg: "We couldn't verify your score with our servers. Please try again in a moment." };

    // Platform.sol: emergency pause
    if (raw.includes("platform paused"))
      return { type: "paused", soft: false, icon: "🔧", title: "Platform Under Maintenance", msg: "ArcadeX is temporarily paused for maintenance. Please check back shortly." };

    // Platform.sol: game not active on-chain
    if (raw.includes("game not active"))
      return { type: "inactive", soft: false, icon: "🎮", title: "Game Unavailable", msg: "This game is currently inactive on-chain. Please contact support if this seems wrong." };

    // Platform.sol: native-token reward pool drained (MST)
    if (raw.includes("pool insufficient"))
      return { type: "pool", soft: false, icon: "💰", title: "Reward Pool Refilling", msg: "The reward pool is temporarily low. Please try again in a little while." };

    // Frontend pre-check: game not registered
    if (raw.includes("game not registered"))
      return { type: "noreg", soft: false, icon: "🎮", title: "Not Registered On-Chain", msg: "This game hasn't been registered on-chain yet. Please contact the creator." };

    // Generic fallback — raw error never shown
    return { type: "error", soft: false, icon: "✕", title: "Submission Failed", msg: "Something went wrong while submitting your score. Please try again." };
  };

  // ── ArcadeX SDK: PURCHASE_SKIN ──────────────────────────────
  const handlePurchaseSkin = async ({ gameId, skinIndex, name, imageURI }) => {
    // SH0006: price client se nahi aata — server se canonical price fetch karo
    if (!address || !GAME_ITEMS_ADDRESS) return;
    console.log("[PURCHASE_SKIN] isNativeToken:", isNativeToken, "| chainId:", CHAIN_ID, "| GAME_ITEMS_ADDRESS:", GAME_ITEMS_ADDRESS);
    const config = wagmiAdapter.wagmiConfig;
    const creatorAddress = game?.creator || address;

    // Server se approved price lo — iframe-supplied price ignore
    let canonicalPrice;
    try {
      const token = localStorage.getItem("arcadex_jwt");
      const priceRes = await fetch("/api/games?action=verify-item-price", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ gameId, itemType: "skin", itemKey: skinIndex }),
      });
      const priceData = await priceRes.json();
      if (!priceData.approved) {
        sendToGame("PURCHASE_FAILED", { kind: "skin", skinIndex, error: priceData.error || "Item not available" });
        return;
      }
      canonicalPrice = priceData.canonicalPrice;
    } catch (err) {
      console.error("[PURCHASE_SKIN] price verify failed:", err);
      sendToGame("PURCHASE_FAILED", { kind: "skin", skinIndex, error: "Could not verify item price" });
      return;
    }

    const priceWei = BigInt(Math.round(Number(canonicalPrice) || 0)) * 10n ** 18n;
    const args = [BigInt(gameId), BigInt(skinIndex), name, imageURI, priceWei, creatorAddress];

    try {
      let hash;
      if (!isNativeToken) {
        // BOTChain: ERC-20 approve (if needed) then purchase
        const allowance = await readContract(config, {
          address: ERC20_TOKEN_ADDRESS, abi: ERC20_ABI,
          functionName: "allowance", args: [address, GAME_ITEMS_ADDRESS], chainId: CHAIN_ID,
        });
        if (allowance < priceWei) {
          const approveHash = await writeContract(config, {
            address: ERC20_TOKEN_ADDRESS, abi: ERC20_ABI,
            functionName: "approve", args: [GAME_ITEMS_ADDRESS, priceWei], chainId: CHAIN_ID,
          });
          await waitForTransactionReceipt(config, { hash: approveHash, chainId: CHAIN_ID });
        }
        hash = await writeContract(config, {
          address: GAME_ITEMS_ADDRESS, abi: GAME_ITEMS_ABI,
          functionName: "purchaseSkinAndMint", args, chainId: CHAIN_ID,
        });
      } else {
        // MST: native MSTC payment
        hash = await writeContract(config, {
          address: GAME_ITEMS_ADDRESS, abi: GAME_ITEMS_ABI,
          functionName: "purchaseSkinAndMint", args, value: priceWei, chainId: CHAIN_ID,
        });
      }
      const receipt = await waitForTransactionReceipt(config, { hash, chainId: CHAIN_ID });
      sendToGame("PURCHASE_SUCCESS", { kind: "skin", skinIndex, tokenId: extractSkinTokenId(receipt, GAME_ITEMS_ADDRESS), txHash: hash });
    } catch (err) {
      console.error("[PURCHASE_SKIN] failed:", err);
      sendToGame("PURCHASE_FAILED", { kind: "skin", skinIndex, error: err.shortMessage || err.message || "Purchase failed" });
    }
  };

  // ── ArcadeX SDK: PURCHASE_POWERUP ───────────────────────────
  const handlePurchasePowerUp = async ({ gameId, powerUpId }) => {
    // SH0006: price client se nahi aata — server se canonical price fetch karo
    if (!address || !GAME_ITEMS_ADDRESS) return;
    console.log("[PURCHASE_POWERUP] isNativeToken:", isNativeToken, "| chainId:", CHAIN_ID, "| GAME_ITEMS_ADDRESS:", GAME_ITEMS_ADDRESS);
    const config = wagmiAdapter.wagmiConfig;
    const creatorAddress = game?.creator || address;

    // Server se approved price lo — iframe-supplied price ignore
    let canonicalPrice;
    try {
      const token = localStorage.getItem("arcadex_jwt");
      const priceRes = await fetch("/api/games?action=verify-item-price", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ gameId, itemType: "powerup", itemKey: powerUpId }),
      });
      const priceData = await priceRes.json();
      if (!priceData.approved) {
        sendToGame("PURCHASE_FAILED", { kind: "powerup", powerUpId, error: priceData.error || "Item not available" });
        return;
      }
      canonicalPrice = priceData.canonicalPrice;
    } catch (err) {
      console.error("[PURCHASE_POWERUP] price verify failed:", err);
      sendToGame("PURCHASE_FAILED", { kind: "powerup", powerUpId, error: "Could not verify item price" });
      return;
    }

    const priceWei = BigInt(Math.round(Number(canonicalPrice) || 0)) * 10n ** 18n;
    const args = [BigInt(gameId), powerUpId, priceWei, creatorAddress];

    try {
      let hash;
      if (!isNativeToken) {
        const allowance = await readContract(config, {
          address: ERC20_TOKEN_ADDRESS, abi: ERC20_ABI,
          functionName: "allowance", args: [address, GAME_ITEMS_ADDRESS], chainId: CHAIN_ID,
        });
        if (allowance < priceWei) {
          const approveHash = await writeContract(config, {
            address: ERC20_TOKEN_ADDRESS, abi: ERC20_ABI,
            functionName: "approve", args: [GAME_ITEMS_ADDRESS, priceWei], chainId: CHAIN_ID,
          });
          await waitForTransactionReceipt(config, { hash: approveHash, chainId: CHAIN_ID });
        }
        hash = await writeContract(config, {
          address: GAME_ITEMS_ADDRESS, abi: GAME_ITEMS_ABI,
          functionName: "purchasePowerUp", args, chainId: CHAIN_ID,
        });
      } else {
        hash = await writeContract(config, {
          address: GAME_ITEMS_ADDRESS, abi: GAME_ITEMS_ABI,
          functionName: "purchasePowerUp", args, value: priceWei, chainId: CHAIN_ID,
        });
      }
      await waitForTransactionReceipt(config, { hash, chainId: CHAIN_ID });
      sendToGame("PURCHASE_SUCCESS", { kind: "powerup", powerUpId, txHash: hash });
    } catch (err) {
      console.error("[PURCHASE_POWERUP] failed:", err);
      sendToGame("PURCHASE_FAILED", { kind: "powerup", powerUpId, error: err.shortMessage || err.message || "Purchase failed" });
    }
  };

  // ── ArcadeX SDK: RECORD_GAME_TIME / GAME_EVENT (off-chain, Firestore) ──
  const handleRecordGameTime = async ({ gameId, seconds, timestamp }) => {
    // SH0008: JWT required — player address backend JWT se lega, client se nahi
    try {
      const token = localStorage.getItem("arcadex_jwt");
      if (!token) return; // silently skip if not authenticated
      await fetch("/api/games?action=record-time", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ gameId, seconds, timestamp, chainId: CHAIN_ID }),
      });
    } catch (err) { console.error("[RECORD_GAME_TIME] failed:", err); }
  };

  const handleGameEvent = async ({ gameId, eventType, value, timestamp }) => {
    // SH0008: JWT required — player address backend JWT se lega, client se nahi
    try {
      const token = localStorage.getItem("arcadex_jwt");
      if (!token) return; // silently skip if not authenticated
      await fetch("/api/games?action=record-event", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ gameId, eventType, value, timestamp, chainId: CHAIN_ID }),
      });
    } catch (err) { console.error("[GAME_EVENT] failed:", err); }
  };

  // ── ClashPot Escrow: CLASHPOT_JOIN ────────────────────────────────────────
  //
  // Game iframe se CLASHPOT_JOIN aata hai jab dono players ready hote hain.
  // Player ke wallet se ClashPotEscrow.join(matchId) call hoti hai stake ke saath.
  //
  // matchId formula TEEN jagah bilkul same hona chahiye:
  //   Frontend :  keccak256(toHex(matchKey))                      <- ye file
  //   Backend  :  ethers.keccak256(ethers.toUtf8Bytes(matchKey))  <- contractCaller.js
  //   Contract :  keccak256(abi.encodePacked(roomId))             <- ClashPotEscrow.sol
  //
  const handleClashPotJoin = async ({ matchKey, stakeWei }) => {
    if (!address) {
      sendToGame("CLASHPOT_JOIN_FAILED", { error: "Wallet not connected" });
      return;
    }

    const escrowAddress = ESCROW_ADDRESS;
    if (!escrowAddress) {
      console.error("[CLASHPOT_JOIN] ESCROW_ADDRESS not set");
      sendToGame("CLASHPOT_JOIN_FAILED", { error: "Escrow contract not configured" });
      return;
    }

    let value;
    try {
      value = BigInt(stakeWei);
      if (value <= 0n) throw new Error("stake <= 0");
    } catch {
      console.error("[CLASHPOT_JOIN] Invalid stakeWei:", stakeWei);
      sendToGame("CLASHPOT_JOIN_FAILED", { error: "Invalid stake amount" });
      return;
    }

    try {
      const matchId = keccak256(toHex(matchKey));

      console.log("[CLASHPOT_JOIN] Depositing stake...", {
        matchKey, matchId, stakeWei: value.toString(), escrowAddress,
      });

      // MST pe chainId NAHI bhejte - warna wallet ka chain-switch popup hang ho jaata hai.
      const hash = await writeContract(wagmiAdapter.wagmiConfig, {
        address: escrowAddress,
        abi: CLASHPOT_ESCROW_ABI,
        functionName: "join",
        args: [matchId],
        value,
      });

      console.log("[CLASHPOT_JOIN] tx sent:", hash, "- receipt poll kar raha hu");

      // waitForTransactionReceipt({chainId}) MST RPC pe reliable nahi.
      // Manual polling - 60 x 2s = 2 min tak.
      const receipt = await pollReceipt(hash);

      if (!receipt) {
        console.warn("[CLASHPOT_JOIN] Receipt timeout - server verify karega");
        sendToGame("CLASHPOT_JOIN_SUCCESS", { txHash: hash });
        return;
      }

      if (receipt.status === "reverted") {
        console.error("[CLASHPOT_JOIN] Transaction reverted");
        sendToGame("CLASHPOT_JOIN_FAILED", { error: "Transaction reverted on-chain" });
        return;
      }

      console.log("[CLASHPOT_JOIN] Deposit confirmed:", hash);
      sendToGame("CLASHPOT_JOIN_SUCCESS", { txHash: hash });

    } catch (err) {
      console.error("[CLASHPOT_JOIN] Failed:", err);
      const msg = err.shortMessage || err.message || "Deposit failed";
      const friendly = /user rejected|denied/i.test(msg) ? "Transaction cancelled" : msg;
      sendToGame("CLASHPOT_JOIN_FAILED", { error: friendly });
    }
  };

  /**
   * Manual receipt polling - MST RPC kabhi-kabhi receipt turant nahi deta.
   */
  const pollReceipt = async (hash, attempts = 60, delayMs = 2000) => {
    for (let i = 0; i < attempts; i++) {
      try {
        const r = await publicClient.getTransactionReceipt({ hash });
        if (r) return r;
      } catch {
        // "not found" normal hai jab tak tx mine na ho - retry
      }
      await new Promise((res) => setTimeout(res, delayMs));
    }
    return null;
  };

  // SDK messages
  useEffect(() => {
    // SH0005 + SH0016: origin allowlist — FAIL-CLOSED.
    // game.iframeUrl se origin nikaalte hain. Agar resolve na ho (empty,
    // relative URL, malformed) toh allowedOrigin null rahega — us case mein
    // SAARE messages reject karo (safe default), warna koi bhi origin se
    // forged message process ho sakta hai.
    let allowedOrigin = null;
    try {
      if (game?.iframeUrl) allowedOrigin = new URL(game.iframeUrl, window.location.origin).origin;
    } catch { allowedOrigin = null; }

    const handleMessage = (event) => {
      // FAIL-CLOSED: origin resolve nahi hua → sab reject
      if (!allowedOrigin) return;
      // Origin match nahi → reject
      if (event.origin !== allowedOrigin) return;
      if (!event.data?._sdk && !event.data?.type) return;
      if (event.data?.type === "SCORE_UPDATE") {
        const sc = Number(event.data.score);
        if (!Number.isFinite(sc) || sc < 0) return; // garbage score ignore
        if (submitted) { setSubmitted(false); setTxHash(""); setSubmitError(null); submittingRef.current = false; }
        setRawGameScore(sc);
        // SH0036/SH0037 — baseline transform via ref (avoids stale-closure).
        // If raw < baseline, game restarted (or new session) → reset baseline to 0.
        const currentBaseline = scoreBaselineRef.current;
        let effectiveBaseline = currentBaseline;
        if (sc < currentBaseline) {
          effectiveBaseline = 0;
          setScoreBaseline(0);
          try {
            const key = `arcadex_score_baseline_${address?.toLowerCase()}_${game?.id}`;
            localStorage.removeItem(key);
          } catch { /* silent */ }
        }
        setScore(Math.max(0, sc - effectiveBaseline));
      }
      if (event.data?.type === "GAME_OVER") {
        const sc = Number(event.data.score);
        if (!Number.isFinite(sc) || sc < 0) return; // garbage score ignore
        setRawGameScore(sc);
        // Baseline transform for GAME_OVER too
        const currentBaseline = scoreBaselineRef.current;
        let effectiveBaseline = currentBaseline;
        if (sc < currentBaseline) {
          effectiveBaseline = 0;
          setScoreBaseline(0);
          try {
            const key = `arcadex_score_baseline_${address?.toLowerCase()}_${game?.id}`;
            localStorage.removeItem(key);
          } catch { /* silent */ }
        }
        const displayScore = Math.max(0, sc - effectiveBaseline);
        setScore(displayScore); setSubmitted(false); setTxHash(""); setSubmitError(null); submittingRef.current = false;
        // Auto-submit with the DELTA score (what user actually earned since last claim)
        submitScore(displayScore);
      }
      if (event.data?.type === "GET_PLAYER_INFO") {
        // allowedOrigin guaranteed truthy yahan (upar check kiya) — "*" fallback nahi
        iframeRef.current?.contentWindow?.postMessage({
          type: "PLAYER_INFO",
          _platform: true,
          player: {
            address: address || "",
            balance: Number(balance)
          }
        }, allowedOrigin);
      }
      if (event.data?.type === "PURCHASE_SKIN") handlePurchaseSkin(event.data);
      if (event.data?.type === "PURCHASE_POWERUP") handlePurchasePowerUp(event.data);
      if (event.data?.type === "RECORD_GAME_TIME") handleRecordGameTime(event.data);
      if (event.data?.type === "GAME_EVENT") handleGameEvent(event.data);
      if (event.data?.type === "CLASHPOT_JOIN") handleClashPotJoin(event.data);
    };
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [address, game, submitted, chainId, contracts, isNativeToken]);

  const handleLike = async () => {
    if (!address) return;
    const key = `liked_game_${gameId}_${address}`;
    if (localStorage.getItem(key)) return;
    localStorage.setItem(key, "1");
    setLiked(true);
    setLikeCount(c => c + 1);
    try {
      const token = localStorage.getItem("arcadex_jwt");
      await fetch("/api/games?action=like", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ gameId }),
      });
    } catch (e) {}
  };

  const handleComment = async () => {
    if (!commentText.trim() || !address || postingComment) return;
    setPostingComment(true);
    const text = commentText.trim();
    setCommentText("");
    try {
      const token = localStorage.getItem("arcadex_jwt");
      await fetch("/api/games?action=comment", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ gameId, text }),
      });
      setComments(prev => [{ id: Date.now(), text, player: address, createdAt: null }, ...prev]);
    } catch (e) { setCommentText(text); }
    finally { setPostingComment(false); }
  };

  // ── TaskOn polling helpers ─────────────────────────────────────
  // startTaskonPolling: kicks off a 2s poll loop that pings the backend
  // check-taskon endpoint. On completion, resumes the submission from
  // where it paused (STEP 3 onwards) with the SAME jwt + session.
  // cancelTaskonPolling: user hit Cancel — clears everything, no
  // submission happens.
  const startTaskonPolling = (jwt) => {
    taskonCancelledRef.current = false;
    const poll = async () => {
      if (taskonCancelledRef.current) return;
      try {
        const r = await fetch("/api/games?action=check-taskon", {
          headers: { Authorization: `Bearer ${jwt}` },
        });
        const d = await r.json().catch(() => ({}));
        if (r.ok && d.completed) {
          // Done! Clear overlay, resume submission with preserved state
          taskonPollTimerRef.current = null;
          setTaskonPolling(null);
          const state = taskonResumeStateRef.current;
          taskonResumeStateRef.current = null;
          submittingRef.current = false;
          setSubmitting(false);
          // Re-enter submitScore with resume state — skips JWT/session
          // reissue and skips the TaskOn check (we know it passes now)
          if (state) submitScore(state.finalScore, state);
          return;
        }
      } catch (e) {
        // Silent — polling is best-effort, next tick will retry
        console.warn("[taskon-poll]", e.message);
      }
      if (!taskonCancelledRef.current) {
        taskonPollTimerRef.current = setTimeout(poll, 2000);
      }
    };
    // First poll after 2s (gives user time to open task)
    taskonPollTimerRef.current = setTimeout(poll, 2000);
  };

  const cancelTaskonPolling = () => {
    taskonCancelledRef.current = true;
    if (taskonPollTimerRef.current) {
      clearTimeout(taskonPollTimerRef.current);
      taskonPollTimerRef.current = null;
    }
    setTaskonPolling(null);
    taskonResumeStateRef.current = null;
    submittingRef.current = false;
    setSubmitting(false);
  };

  // Update elapsed-time counter while polling (for the "waiting 0:32" UI)
  useEffect(() => {
    if (!taskonPolling) { setTaskonElapsed(0); return; }
    const start = taskonStartTimeRef.current || Date.now();
    setTaskonElapsed(Math.floor((Date.now() - start) / 1000));
    const t = setInterval(() => {
      setTaskonElapsed(Math.floor((Date.now() - start) / 1000));
    }, 1000);
    return () => clearInterval(t);
  }, [taskonPolling]);

  // Cleanup poll timer on unmount so it doesn't fire on a dead component
  useEffect(() => {
    return () => {
      if (taskonPollTimerRef.current) clearTimeout(taskonPollTimerRef.current);
    };
  }, []);

  const submitScore = async (finalScore, resumeState = null) => {
    if (submittingRef.current || !address || !game) return;

    // SH0036 — MST team's requested gate: block submission if user hasn't
    // earned fresh minScore points since last claim. `finalScore` at this
    // point is ALREADY the delta (SCORE_UPDATE/GAME_OVER handlers subtract
    // baseline before passing here, and the manual submit button uses
    // `score` state which is also baseline-adjusted). So a simple
    // "score >= minScore" check enforces the "earn 500 fresh points"
    // requirement. Pehle user Level 7 pe claim → Level 15 pe accumulated
    // score se dobara claim kar sakta tha (multiple rewards, koi extra
    // effort nahi). Ab har claim ke liye fresh 500 points earn karne hi
    // padenge — reward pool drain rate slow ho jayegi drastically.
    //
    // SH0037 — read minScore from ref, not closure. Message-listener
    // useEffect deps don't include minScore, so the listener's captured
    // submitScore had stale null/undefined value → gate silently bypassed.
    const currentMinScore = minScoreRef.current;
    if (currentMinScore !== null && Number(finalScore) < Number(currentMinScore)) {
      setSubmitError({
        type: "min-score", soft: true, icon: "🎯",
        title: "Earn more points to claim",
        msg: `You need ${Number(currentMinScore).toLocaleString()} points since your last claim. Current: ${Number(finalScore).toLocaleString()} — keep playing!`,
      });
      return;
    }

    submittingRef.current = true;
    setSubmitting(true); setSubmitError(null);
    try {
      const onChainGameId = game.gameId;
      if (!onChainGameId) throw new Error("Game not registered on-chain");
      const rewardRate = (isNativeToken ? game.rewardRateNative : game.rewardRate) || (isNativeToken ? 1 : 50);
      // SH0037 — read playerSplit from ref. Message-listener useEffect deps
      // don't include playerSplit, so the listener's captured submitScore
      // had stale default 80 → sidebar showed "+0.5 You earn" (from fresh
      // render with playerSplit=100) but success overlay showed "+0.4"
      // (from stale closure). Ref sync guarantees latest value.
      const currentSplit = playerSplitRef.current;
      // Math.floor() was rounding native-chain estimates (rate 1-2) straight
      // to 0 — 80% of 1 is 0.8, floors to 0. Round to 2 decimals instead so
      // small native-token amounts still show up.
      const playerReward = Math.round(rewardRate * currentSplit / 100 * 100) / 100;

      // ── STEP 1 + STEP 2: Only run on fresh submission ─────────────
      // When resuming after a TaskOn wait, we intentionally reuse the
      // ORIGINAL jwt + session captured pre-wait. Reason: session's
      // createdAt is stored server-side; reusing it means the sign-score
      // playSec measurement reflects real gameplay + TaskOn wait time,
      // which comfortably passes GATE 1 (min play time). A fresh session
      // here would reset playSec to ~0 and fail GATE 1 for a legit user
      // who just spent minutes completing the community task.
      let _jwt, _session;
      if (resumeState) {
        _jwt     = resumeState.jwt;
        _session = resumeState.session;
      } else {
        // ── STEP 1: Ensure JWT (sign-in if missing/expired) ──────────
        // OLD: hard-errored "Not Signed In" and asked user to reconnect
        // wallet — mobile users had no idea what to do. NEW: trigger
        // sign-in inline via the shared helper. Overlay tells them
        // exactly what's happening ("Check your wallet for a signature
        // request — it's free, no gas").
        _jwt = localStorage.getItem("arcadex_jwt");
        if (!_jwt || !hasValidJwtForWallet(address)) {
          // Start with the "verify" sub-stage — Turnstile browser verification.
          // signInAndGetJwt calls onPhase("sign") when the wallet prompt is
          // about to appear, so the overlay switches from "verifying browser"
          // to "check your wallet" only when the wallet popup actually shows.
          // Prevents the confusing 20-second gap where the overlay said
          // "check your wallet" but the wallet prompt hadn't appeared yet.
          setSubmitStage("auth-verify");
          try {
            _jwt = await signInAndGetJwt(address, walletClient, getTurnstileToken, (phase) => {
              if (phase === "verify") setSubmitStage("auth-verify");
              else if (phase === "sign") setSubmitStage("auth");
              else if (phase === "post") setSubmitStage("auth-post");
            });
          } catch (authErr) {
            // User rejected the signature — dismiss overlay, show soft
            // error explaining what the signature was for so they'll try
            // again next time. (Point 4 from the roadmap.)
            setSubmitStage(null);
            setSubmitError({
              type: "auth", soft: true, icon: "🔐",
              title: "Sign-In Cancelled",
              msg: "You need to sign a free message (no gas, no cost) to prove your wallet owns this score. Tap Submit again to retry."
            });
            setSubmitting(false); submittingRef.current = false; return;
          }
        }

        // ── STEP 2: Ensure gameplay session token ────────────────────
        // OLD: hard-errored "Session Expired, reload the page" if the
        // on-mount startSession didn't run (e.g. JWT was missing then).
        // NEW: fetch one inline — now we definitely have a JWT.
        _session = sessionTokenRef.current;
        if (!_session) {
          setSubmitStage("session");
          try {
            const sRes = await fetch("/api/games?action=start-session", {
              method: "POST",
              headers: { "Content-Type": "application/json", Authorization: `Bearer ${_jwt}` },
              body: JSON.stringify({ gameId: onChainGameId, chain: chainKey }),
            });
            if (!sRes.ok) throw new Error("Session start failed");
            const { sessionToken } = await sRes.json();
            _session = sessionToken;
            sessionTokenRef.current = sessionToken;
          } catch (sessErr) {
            setSubmitStage(null);
            setSubmitError({
              type: "session", soft: false, icon: "🔄",
              title: "Session Setup Failed",
              msg: "Could not prepare your gameplay session. Please reload the page and try again."
            });
            setSubmitting(false); submittingRef.current = false; return;
          }
        }
      }

      // ── STEP 2.5: TaskOn campaign gate ──────────────────────────
      // Skipped when resuming — polling already confirmed completion.
      // On a fresh submission where the wallet hasn't completed yet, we
      // pause here and hand off to the full-screen taskonPolling overlay,
      // which polls every 2s and resumes this function on success. The
      // ORIGINAL _jwt + _session get preserved in taskonResumeStateRef
      // so the resume call bypasses STEP 1+2 (see block above).
      if (!resumeState) {
        setSubmitStage("taskon");
        try {
          const tRes = await fetch("/api/games?action=check-taskon", {
            headers: { Authorization: `Bearer ${_jwt}` },
          });
          const tData = await tRes.json().catch(() => ({}));
          if (tRes.ok && tData.taskonEnabled && !tData.completed) {
            setSubmitStage(null);
            // Preserve state for the polling callback to resume with
            taskonResumeStateRef.current = { jwt: _jwt, session: _session, finalScore };
            taskonStartTimeRef.current = Date.now();
            setTaskonPolling({
              campaignUrl: tData.campaignUrl,
              startedAt:   Date.now(),
            });
            startTaskonPolling(_jwt);
            // IMPORTANT: don't clear submittingRef here — polling overlay
            // is now the source of truth for "user is mid-submission".
            // Cancel button clears both state and ref. Success path (in
            // startTaskonPolling's poll callback) also clears and then
            // re-enters submitScore with resumeState.
            return;
          }
        } catch (tErr) {
          // TaskOn network issue — don't block; sign-score will enforce
          // if it's actually required. Frontend fails open here.
          console.warn("[taskon] check failed, proceeding:", tErr.message);
        }
      }

      // ── STEP 3: Backend sign-score (ECDSA proof) ─────────────────
      setSubmitStage("signing");
      let nonce, signature;
      let tNonce = null, tSig = null;   // tournament proof (set below if tournamentId)
      try {
        const sigRes = await fetch("/api/games?action=sign-score", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${_jwt}` },
          // player field nahi — backend JWT se lega (SH0009)
          // tournamentId bhejte hain taaki backend usi validated score pe
          // tournament proof bhi sign kar de (ek session burn, dono proofs)
          body: JSON.stringify({ gameId: onChainGameId, score: finalScore, chain: chainKey, sessionToken: _session, tournamentId: tournamentId || undefined }),
        });
        if (!sigRes.ok) {
          const errData = await sigRes.json().catch(() => ({}));
          setSubmitStage(null);
          // Backend TaskOn gate — should have been caught in STEP 2.5,
          // but if the check-taskon call failed we ended up here. Fall
          // through to the same polling overlay UX instead of a raw error.
          if (errData.requiresTaskOn) {
            taskonResumeStateRef.current = { jwt: _jwt, session: _session, finalScore };
            taskonStartTimeRef.current = Date.now();
            setTaskonPolling({
              campaignUrl: errData.campaignUrl || "https://taskon.xyz/",
              startedAt:   Date.now(),
            });
            startTaskonPolling(_jwt);
            return; // submittingRef stays true; polling overlay owns lifecycle
          } else {
            setSubmitError({ type: "session", soft: false, icon: "🔐", title: "Score Verification Failed", msg: errData.error || "Could not verify gameplay session. Reload the page and try again." });
          }
          setSubmitting(false); submittingRef.current = false; return;
        }
        const sigData = await sigRes.json();
        nonce = BigInt(sigData.nonce);
        signature = sigData.signature;
        tNonce = sigData.tournamentNonce ? BigInt(sigData.tournamentNonce) : null;
        tSig   = sigData.tournamentSignature || null;
        sessionTokenRef.current = null; // burn — one-time use

        // Auto-renew session for next game round (background, non-blocking)
        ;(async () => {
          try {
            const t = localStorage.getItem("arcadex_jwt");
            if (!t) return;
            const r = await fetch("/api/games?action=start-session", {
              method: "POST",
              headers: { "Content-Type": "application/json", Authorization: `Bearer ${t}` },
              body: JSON.stringify({ gameId: onChainGameId, chain: chainKey }),
            });
            if (r.ok) {
              const { sessionToken: newToken } = await r.json();
              sessionTokenRef.current = newToken;
              console.log("[session] renewed:", newToken?.slice(0, 8) + "...");
            }
          } catch (e) { console.warn("[session] renew failed:", e); }
        })();
      } catch (sigErr) {
        setSubmitStage(null);
        setSubmitError({ type: "session", soft: false, icon: "🔐", title: "Score Verification Failed", msg: "Network error while verifying score. Please try again." });
        setSubmitting(false); submittingRef.current = false; return;
      }

      // ── STEP 4: Wallet — user approves the tx ────────────────────
      setSubmitStage("wallet");
      const hash = await writeContract(wagmiAdapter.wagmiConfig, {
        address: PLATFORM_ADDRESS, abi: PLATFORM_ABI,
        functionName: "recordPlayAndEarn",
        args: [BigInt(onChainGameId), BigInt(finalScore), nonce, signature],
        gas: BigInt(500000),
        chainId: CHAIN_ID,
      });

      // ── STEP 5: Wait for on-chain receipt ────────────────────────
      setSubmitStage("confirming");
      await waitForTransactionReceipt(wagmiAdapter.wagmiConfig, { hash });

      if (tournamentId && tSig) {
        try {
          const tHash = await writeContract(wagmiAdapter.wagmiConfig, {
            address: TOURNAMENT_ADDRESS, abi: TOURNAMENT_SCORE_ABI,
            functionName: "submitTournamentScore",
            args: [BigInt(tournamentId), BigInt(finalScore), tNonce, tSig],
            gas: BigInt(250000), chainId: CHAIN_ID,
          });
          await waitForTransactionReceipt(wagmiAdapter.wagmiConfig, { hash: tHash });
        } catch (tErr) {
          // ab silently swallow nahi — real failures console mein dikhenge
          console.error("Tournament score submit failed:", tErr);
          if (tErr.message?.includes("Finished") || tErr.message?.includes("Outside time") || tErr.message?.includes("Not joined")) {
            setSubmitError({ type: "tournament", soft: true, icon: "🏆", title: "Tournament Ended", msg: "This tournament has ended — your score wasn't counted for the tournament, but your on-chain reward was still paid." });
          }
        }
      } else if (tournamentId && !tSig) {
        // tournamentId tha par backend ne proof nahi diya (TOURNAMENT_ADDRESSES map miss?)
        console.warn("Tournament play but no proof returned — check TOURNAMENT_ADDRESSES / SCORE_SIGNER config.");
      }

      setTokensEarned(playerReward);
      await saveScore({ player: address, score: finalScore, gameId: game.id, gameName: game.name, txHash: hash, chain: chainKey, earned: playerReward, earnedSymbol: rewardSymbol });
      setTxHash(hash); setSubmitted(true);
      sendToGame("TRANSACTION_SUCCESS", { txHash: hash });

      // SH0036 — MST team fix: reset displayed score to 0 after successful
      // claim. Persist baseline = current raw game score, so next SCORE_UPDATE
      // from iframe shows only NEW points earned since this claim. User has
      // to earn a fresh minScore worth of points before next submit is allowed.
      //
      // SH0037 — read rawGameScore from ref. Message-listener closure had
      // stale rawGameScore from when useEffect ran (usually 0). Ref sync
      // ensures we save the latest actual score as baseline.
      try {
        const currentRaw = rawGameScoreRef.current;
        const key = `arcadex_score_baseline_${address.toLowerCase()}_${game.id}`;
        localStorage.setItem(key, String(currentRaw));
        setScoreBaseline(currentRaw);
        setScore(0);   // display resets to 0 immediately
      } catch { /* silent — baseline sync will just re-fetch from raw */ }

      // SH0035 — cache-bust after successful score submit. Backend edge
      // cache serves stale data (2 min for scores, 3 min for stats, 5 min
      // for games list) to save cost. But user just submitted a score aur
      // usually turant leaderboard / earnings check karega — usko fresh
      // data chahiye. sessionStorage clears force next fetch to bypass
      // client cache; backend Edge cache still serves stale for others but
      // user-perceived UX is instant.
      try {
        bustGamesCache();                              // Home/Games/Leaderboard lists
        sessionStorage.removeItem("scores_cache");     // Any local scores cache
        sessionStorage.removeItem("navbar_earnings");  // Navbar earnings panel
      } catch { /* silent */ }

      // ── STEP 6: Success flash, then auto-dismiss ─────────────────
      setSubmitStage("success");
      setTimeout(() => setSubmitStage(null), 2500);
    } catch (err) {
      // Wallet reject, tx failure, network drop — dismiss overlay
      // immediately so the existing error card can take over. This is
      // the "agar transaction cancel kre to overlay hat jaye" behaviour.
      setSubmitStage(null);
      const parsed = parseContractError(err);
      setSubmitError(parsed);
      sendToGame("TRANSACTION_FAILED", { error: parsed.msg });
    } finally { setSubmitting(false); submittingRef.current = false; }
  };

  if (gameLoading) return (
    <div style={{ minHeight: "calc(100vh - 54px)", background: C.bg, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ fontFamily: C.raj, fontSize: 11, color: C.dimMore, textTransform: "uppercase", letterSpacing: "2px" }}>Loading game...</div>
    </div>
  );
  if (!game) return (
    <div style={{ minHeight: "calc(100vh - 54px)", background: C.bg, display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 12 }}>
      <div style={{ fontSize: 48 }}>🎮</div>
      <div style={{ fontFamily: C.raj, fontWeight: 700, fontSize: 16, color: "#c4a0ff" }}>Game not found</div>
      <button onClick={() => navigate("/games")} style={{ padding: "8px 20px", background: "rgba(123,47,255,0.1)", border: `1px solid ${C.border2}`, borderRadius: 8, color: "#a67fff", fontSize: 12, cursor: "pointer", fontFamily: C.raj, fontWeight: 700 }}>Browse Games</button>
    </div>
  );

  const rewardRate = (isNativeToken ? game.rewardRateNative : game.rewardRate) || (isNativeToken ? 1 : 50);
  const playerReward = Math.round(rewardRate * playerSplit / 100 * 100) / 100;
  const creatorReward = Math.round(rewardRate * creatorSplit / 100 * 100) / 100;
  const shortAddr = (a) => a ? a.slice(0, 6) + "..." + a.slice(-4) : "?";
  const thumbnail = game.thumbnailUrl || game.thumbnail || game.image || null;
  const hasHelpContent = !!(game.helpContent && Object.values(game.helpContent).some(v => v && v.trim()));

  // ── SEO (React 19 hoists these into <head>) ──────────────────────────────
  const gameSlugId = game.gameId || game.id;
  const seoDesc = (game.description
    || `Play ${game.name} on ArcadeX — a free on-chain ${game.category || "arcade"} game. Compete on verified leaderboards and earn token rewards, instantly in your browser.`);
  const gameJsonLd = {
    "@context": "https://schema.org",
    "@type": "VideoGame",
    name: game.name,
    description: seoDesc.slice(0, 300),
    url: `https://www.playarcadex.in/play/${gameSlugId}`,
    ...(thumbnail ? { image: thumbnail } : {}),
    ...(game.category ? { genre: game.category } : {}),
    applicationCategory: "GameApplication",
    operatingSystem: "Web browser",
    offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
    publisher: { "@type": "Organization", name: "ArcadeX", url: "https://www.playarcadex.in" },
  };

  // ── Error card helper — called in JSX ────────────────────────────────────
  // ── Full-screen submit-flow overlay ─────────────────────────────
  // Modal-style overlay covering the whole viewport (fixed + high
  // z-index so it works even when GameFrame is in fake-FS mode).
  // Each stage tells the user EXACTLY what's happening so no one is
  // sitting there wondering whether the wallet popup is coming.
  //
  // Design decision: no in-overlay Cancel button. Trying to add one
  // that "cancels" would be a lie — once the wallet popup is up, only
  // the wallet itself can dismiss it. If the user rejects in-wallet,
  // our catch block runs, sets submitStage=null, and the existing
  // error card takes over. This is the same pattern Uniswap/OpenSea
  // use for their tx-confirmation modals.
  const renderSubmitOverlay = () => {
    if (!submitStage) return null;
    const stages = {
      "auth-verify": {
        icon: "🛡️",
        title: "Verifying your browser",
        msg: "One-time browser check to protect the reward pool from bots. This takes a few seconds — please wait…",
        accent: "#7B2FFF",
        spin: true,
      },
      auth: {
        icon: "🔐",
        title: "Sign in your wallet",
        msg: "Check your wallet for a signature request — it's free (no gas). This just proves your wallet owns the score.",
        accent: "#7B2FFF",
        spin: true,
      },
      "auth-post": {
        icon: "🔐",
        title: "Signing you in",
        msg: "Almost done — completing sign-in…",
        accent: "#7B2FFF",
        spin: true,
      },
      session: {
        icon: "⚙️",
        title: "Preparing your score",
        msg: "Setting up a secure gameplay session…",
        accent: "#7B2FFF",
        spin: true,
      },
      taskon: {
        icon: "🎯",
        title: "Checking community task",
        msg: "Verifying your TaskOn completion…",
        accent: "#7B2FFF",
        spin: true,
      },
      signing: {
        icon: "📝",
        title: "Verifying your score",
        msg: "Our server is signing your score so the blockchain can trust it…",
        accent: "#7B2FFF",
        spin: true,
      },
      wallet: {
        icon: "⛓️",
        title: "Confirm in your wallet",
        msg: "Approve the transaction in your wallet to record your score on-chain. On mobile, check for a notification from your wallet app.",
        accent: "#00d4ff",
        spin: true,
      },
      confirming: {
        icon: "⏳",
        title: "Confirming on-chain",
        msg: "Your transaction is being mined. Please don't refresh — this usually takes a few seconds.",
        accent: "#00d4ff",
        spin: true,
      },
      success: {
        icon: "✅",
        title: "Score submitted!",
        msg: tokensEarned > 0 ? `+${tokensEarned} ${rewardSymbol} earned` : "Your score is now on-chain.",
        accent: "#00e676",
        spin: false,
      },
    };
    const s = stages[submitStage] || stages.wallet;
    return (
      <>
        <style>{`
          @keyframes soFadeIn { from { opacity: 0 } to { opacity: 1 } }
          @keyframes soCardIn { from { opacity: 0; transform: translate(-50%,-50%) scale(0.94) } to { opacity: 1; transform: translate(-50%,-50%) scale(1) } }
          @keyframes soSpin { to { transform: rotate(360deg) } }
          @keyframes soFloat { 0%,100% { transform: translateY(0) } 50% { transform: translateY(-4px) } }
          @keyframes soCheck { 0% { transform: scale(0.3); opacity: 0 } 60% { transform: scale(1.15) } 100% { transform: scale(1); opacity: 1 } }
        `}</style>
        <div style={{
          position: "fixed", inset: 0, zIndex: 20000,
          background: "rgba(4,3,10,0.82)", backdropFilter: "blur(10px)",
          animation: "soFadeIn 0.22s ease",
        }} />
        <div style={{
          position: "fixed", top: "50%", left: "50%",
          transform: "translate(-50%,-50%)",
          zIndex: 20001, width: "min(370px, 90vw)",
          background: "linear-gradient(160deg, #141021, #0d0a17)",
          border: `1px solid ${s.accent}44`, borderRadius: 20,
          padding: "34px 28px 30px",
          textAlign: "center",
          boxShadow: `0 20px 70px rgba(0,0,0,0.6), 0 0 40px ${s.accent}22`,
          fontFamily: "'Rajdhani',sans-serif",
          animation: "soCardIn 0.32s cubic-bezier(0.34,1.56,0.64,1)",
        }}>
          {/* Icon + spinner ring */}
          <div style={{
            width: 72, height: 72, margin: "0 auto 20px",
            borderRadius: "50%",
            background: `linear-gradient(135deg, ${s.accent}, ${s.accent}bb)`,
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 32,
            boxShadow: `0 0 30px ${s.accent}55`,
            animation: submitStage === "success" ? "soCheck 0.5s ease" : "soFloat 2.6s ease-in-out infinite",
            position: "relative",
          }}>
            <span style={{ position: "relative", zIndex: 2 }}>{s.icon}</span>
            {s.spin && (
              <div style={{
                position: "absolute", inset: -6,
                borderRadius: "50%",
                border: "2px solid transparent",
                borderTopColor: s.accent,
                borderRightColor: `${s.accent}66`,
                animation: "soSpin 1.1s linear infinite",
              }} />
            )}
          </div>
          <div style={{
            fontSize: 20, fontWeight: 800,
            color: submitStage === "success" ? s.accent : "#fff",
            marginBottom: 10, letterSpacing: "0.3px",
          }}>{s.title}</div>
          <div style={{
            fontSize: 13, color: "#b8b0d0", lineHeight: 1.6,
          }}>{s.msg}</div>
          {/* Wallet-stage hint on mobile — small nudge in case wallet popup didn't autofocus */}
          {submitStage === "wallet" && isMobile && (
            <div style={{
              marginTop: 16, padding: "8px 12px",
              background: "rgba(0,212,255,0.06)",
              border: "1px solid rgba(0,212,255,0.15)",
              borderRadius: 8,
              fontSize: 11, color: "#a67fff", lineHeight: 1.5,
            }}>
              💡 If your wallet didn't open automatically, switch to your wallet app manually.
            </div>
          )}
        </div>
      </>
    );
  };

  // ── Full-screen TaskOn polling overlay ──────────────────────────
  // Shown when the wallet hasn't completed the community task yet.
  // Mirrors renderSubmitOverlay's visual language (backdrop blur, gradient
  // card, floating icon) but with:
  //   • prominent gold "Open Task" CTA — opens TaskOn campaign in new tab
  //   • live polling indicator with elapsed-time counter
  //   • subtle Cancel that aborts polling and unlocks the Submit button
  // The overlay stays up until either (a) backend check-taskon returns
  // completed:true → auto-resumes submission, or (b) user hits Cancel.
  const renderTaskonOverlay = () => {
    if (!taskonPolling) return null;
    const { campaignUrl } = taskonPolling;
    const mm = String(Math.floor(taskonElapsed / 60)).padStart(1, "0");
    const ss = String(taskonElapsed % 60).padStart(2, "0");
    return (
      <>
        <style>{`
          @keyframes tsFadeIn { from { opacity: 0 } to { opacity: 1 } }
          @keyframes tsCardIn { from { opacity: 0; transform: translate(-50%,-50%) scale(0.94) } to { opacity: 1; transform: translate(-50%,-50%) scale(1) } }
          @keyframes tsSpin { to { transform: rotate(360deg) } }
          @keyframes tsFloat { 0%,100% { transform: translateY(0) } 50% { transform: translateY(-5px) } }
          @keyframes tsGlow { 0%,100% { box-shadow: 0 0 24px rgba(255,183,0,0.4), 0 0 48px rgba(255,183,0,0.15) } 50% { box-shadow: 0 0 32px rgba(255,183,0,0.55), 0 0 64px rgba(255,183,0,0.25) } }
          @keyframes tsDots { 0%,20% { content: "" } 40% { content: "." } 60% { content: ".." } 80%,100% { content: "..." } }
          .ts-cta:hover { transform: translateY(-1px); filter: brightness(1.08); }
          .ts-cta:active { transform: translateY(0); }
          .ts-cancel:hover { color: #a67fff !important; border-color: rgba(167,127,255,0.4) !important; }
        `}</style>
        <div style={{
          position: "fixed", inset: 0, zIndex: 20000,
          background: "rgba(4,3,10,0.86)", backdropFilter: "blur(12px)",
          animation: "tsFadeIn 0.3s ease",
        }}>
          <div style={{
            position: "absolute", top: "50%", left: "50%",
            transform: "translate(-50%,-50%)",
            width: isMobile ? "calc(100vw - 28px)" : 440,
            maxWidth: 440,
            background: "linear-gradient(180deg, rgba(35,20,70,0.98), rgba(15,10,32,0.98))",
            border: "1px solid rgba(255,183,0,0.3)",
            borderRadius: 18,
            padding: isMobile ? "30px 22px 22px" : "36px 28px 26px",
            boxShadow: "0 30px 80px rgba(0,0,0,0.7), 0 0 60px rgba(255,183,0,0.12)",
            animation: "tsCardIn 0.42s cubic-bezier(0.16,1,0.3,1)",
          }}>
            {/* Icon */}
            <div style={{
              fontSize: 54, textAlign: "center", marginBottom: 14,
              animation: "tsFloat 2.8s ease-in-out infinite",
              filter: "drop-shadow(0 4px 20px rgba(255,183,0,0.35))",
            }}>🎯</div>

            {/* Title */}
            <div style={{
              fontFamily: C.raj, fontWeight: 800, fontSize: 20, color: "#fff",
              textAlign: "center", marginBottom: 8, letterSpacing: "0.3px",
            }}>
              Complete Community Task
            </div>

            {/* Subtitle */}
            <div style={{
              fontFamily: C.raj, fontWeight: 700, fontSize: 12, color: C.gold,
              textAlign: "center", marginBottom: 14, letterSpacing: "0.8px",
              textTransform: "uppercase",
            }}>
              ⚡ One-Time Activity
            </div>

            {/* Description */}
            <div style={{
              fontFamily: C.raj, fontSize: 13, color: "#d9c7ff",
              textAlign: "center", lineHeight: 1.65, marginBottom: 6,
            }}>
              Complete the task on TaskOn to unlock <span style={{ color: C.gold, fontWeight: 700 }}>MSTC rewards</span> from ArcadeX.
            </div>
            <div style={{
              fontFamily: C.raj, fontSize: 11, color: "#9077cc",
              textAlign: "center", lineHeight: 1.6, marginBottom: 22,
            }}>
              You only need to do this once per wallet. We'll auto-detect when you're done.
            </div>

            {/* Primary CTA */}
            <button
              className="ts-cta"
              onClick={() => window.open(campaignUrl, "_blank", "noopener,noreferrer")}
              style={{
                width: "100%",
                padding: "14px 18px",
                background: "linear-gradient(135deg, #FFB700, #FF8C00)",
                border: "none", borderRadius: 12, cursor: "pointer",
                fontFamily: C.raj, fontWeight: 800, fontSize: 14,
                color: "#1a0f00", letterSpacing: "0.6px",
                marginBottom: 16,
                transition: "transform 0.15s, filter 0.15s",
                animation: "tsGlow 2.4s ease-in-out infinite",
                display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
              }}>
              <span style={{ fontSize: 16 }}>🔗</span>
              <span>Open Task on TaskOn</span>
            </button>

            {/* Polling status card */}
            <div style={{
              display: "flex", alignItems: "center", gap: 12,
              padding: "13px 16px",
              background: "rgba(123,47,255,0.09)",
              border: "1px solid rgba(123,47,255,0.22)",
              borderRadius: 12, marginBottom: 14,
            }}>
              <div style={{
                width: 16, height: 16, borderRadius: "50%", flexShrink: 0,
                border: `2px solid ${C.purpleL}`, borderTopColor: "transparent",
                animation: "tsSpin 0.85s linear infinite",
              }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{
                  fontFamily: C.raj, fontWeight: 700, fontSize: 12,
                  color: "#c9b3ff", marginBottom: 2,
                }}>
                  Waiting for task completion
                </div>
                <div style={{
                  fontFamily: C.raj, fontSize: 10.5, color: "#7a5aa8",
                  letterSpacing: "0.3px",
                }}>
                  Checking every 2 seconds · {mm}:{ss} elapsed
                </div>
              </div>
            </div>

            {/* Helper text */}
            <div style={{
              fontFamily: C.raj, fontSize: 10.5, color: "#6a5292",
              textAlign: "center", lineHeight: 1.5, marginBottom: 14,
              fontStyle: "italic",
            }}>
              Tip: task usually takes under a minute. Keep this tab open.
            </div>

            {/* Cancel */}
            <button
              className="ts-cancel"
              onClick={cancelTaskonPolling}
              style={{
                width: "100%", padding: "10px",
                background: "transparent",
                border: `1px solid ${C.border2}`, borderRadius: 9, cursor: "pointer",
                fontFamily: C.raj, fontWeight: 600, fontSize: 11,
                color: "#7a5aa8", letterSpacing: "0.5px",
                transition: "color 0.15s, border-color 0.15s",
              }}>
              Cancel
            </button>
          </div>
        </div>
      </>
    );
  };

  const renderErrorCard = () => {
    if (!submitError) return null;
    const isSoft = submitError.soft;
    const borderColor = isSoft ? "rgba(255,183,0,0.25)" : "rgba(255,68,68,0.2)";
    const bgColor     = isSoft ? "rgba(255,183,0,0.05)"  : "rgba(255,68,68,0.06)";
    const titleColor  = isSoft ? C.gold                   : "#ff4444";
    // Cap + duplicate: no retry makes sense (must wait). Others: show Try Again.
    const showRetry   = !["cap", "duplicate", "paused"].includes(submitError.type);
    return (
      <div style={{ background: bgColor, border: `1px solid ${borderColor}`, borderRadius: 10, padding: "14px 16px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
          <span style={{ fontSize: 16, lineHeight: 1 }}>{submitError.icon}</span>
          <span style={{ fontFamily: C.raj, fontWeight: 700, fontSize: 12, color: titleColor, letterSpacing: "0.3px" }}>
            {submitError.title}
          </span>
        </div>
        <div style={{ fontSize: 11, color: "#9977cc", fontFamily: C.raj, lineHeight: 1.6 }}>
          {submitError.msg}
        </div>
        {showRetry && (
          <button
            onClick={() => setSubmitError(null)}
            style={{ marginTop: 10, fontSize: 10, color: C.purpleL, background: "transparent", border: `1px solid ${C.border2}`, borderRadius: 6, padding: "4px 14px", cursor: "pointer", fontFamily: C.raj, fontWeight: 700, letterSpacing: "0.5px" }}>
            Try Again
          </button>
        )}
      </div>
    );
  };

  return (
    <div style={{ minHeight: "calc(100vh - 54px)", background: C.bg }}>
      <Seo
        title={game.name}
        description={seoDesc}
        path={`/play/${gameSlugId}`}
        image={thumbnail || undefined}
        jsonLd={gameJsonLd}
      />
      <style>{`
        @keyframes lbPulse{0%,100%{opacity:1}50%{opacity:0.3}}
        @keyframes poweredGlow{0%,100%{opacity:0.7}50%{opacity:1}}
        @keyframes heartBeat{0%,100%{transform:scale(1)}50%{transform:scale(1.35)}}
        @keyframes slideIn{from{opacity:0;transform:translateY(-6px)}to{opacity:1;transform:translateY(0)}}
        @keyframes scoreFlash{0%{transform:scale(1)}50%{transform:scale(1.06)}100%{transform:scale(1)}}
        .like-btn:hover{background:rgba(255,100,100,0.1)!important;border-color:rgba(255,100,100,0.3)!important;}
        .comment-input:focus{outline:none;border-color:rgba(123,47,255,0.5)!important;}
        .comment-input::placeholder{color:#3a2a5a;}
        .comment-row:hover{background:rgba(123,47,255,0.05)!important;}
        .send-btn:hover:not(:disabled){background:linear-gradient(135deg,#8f44ff,#6b2fe8)!important;}
        .send-btn:disabled{opacity:0.3;cursor:not-allowed;}
        * { scrollbar-width: none; }
        *::-webkit-scrollbar { display: none; }
      `}</style>

      {/* ── GAME HEADER with thumbnail bg ── */}
      <div style={{ position: "relative", overflow: "hidden", borderBottom: `1px solid ${C.border}` }}>
        {thumbnail && (
          <>
            <div style={{ position: "absolute", inset: 0, backgroundImage: `url(${thumbnail})`, backgroundSize: "cover", backgroundPosition: "center", filter: "blur(18px) brightness(0.22)", transform: "scale(1.1)" }} />
            <div style={{ position: "absolute", inset: 0, background: "linear-gradient(180deg, rgba(8,7,15,0.3) 0%, rgba(8,7,15,0.85) 100%)" }} />
          </>
        )}
        {!thumbnail && <div style={{ position: "absolute", inset: 0, background: "linear-gradient(135deg, rgba(123,47,255,0.1), rgba(0,212,255,0.05))" }} />}

        <div style={{ position: "relative", zIndex: 1, padding: isMobile ? "14px 16px" : "16px 32px", display: "flex", alignItems: "center", gap: 14 }}>
          <button onClick={() => navigate(-1)} style={{ padding: "7px 14px", background: "rgba(0,0,0,0.5)", border: `1px solid ${C.border2}`, borderRadius: 7, color: "#a67fff", fontSize: 12, cursor: "pointer", fontFamily: C.raj, fontWeight: 700, backdropFilter: "blur(8px)", flexShrink: 0 }}>← Back</button>

          {hasHelpContent && (
            <button onClick={() => setShowHelpModal(true)} style={{ padding: "7px 14px", background: "rgba(123,47,255,0.15)", border: `1px solid ${C.border2}`, borderRadius: 7, color: C.purpleL, fontSize: 12, cursor: "pointer", fontFamily: C.raj, fontWeight: 700, backdropFilter: "blur(8px)", flexShrink: 0, whiteSpace: "nowrap" }}>
              ❓ How to Play
            </button>
          )}

          {/* Thumbnail icon */}
          <div style={{ width: isMobile ? 48 : 56, height: isMobile ? 48 : 56, borderRadius: 10, overflow: "hidden", border: `2px solid ${C.border2}`, flexShrink: 0, background: "#0e0c1a", boxShadow: "0 4px 20px rgba(0,0,0,0.5)" }}>
            {thumbnail ? (
              <img src={thumbnail} alt={game.name} style={{ width: "100%", height: "100%", objectFit: "contain", objectPosition: "center", background: "#0e0c1a" }} />
            ) : (
              <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22, background: "linear-gradient(135deg,rgba(123,47,255,0.3),rgba(0,212,255,0.1))" }}>🎮</div>
            )}
          </div>

          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontFamily: C.raj, fontWeight: 700, fontSize: isMobile ? 18 : 22, color: "#fff", textTransform: "uppercase", letterSpacing: "0.5px", lineHeight: 1.1, marginBottom: 3 }}>{game.name}</div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              {game.category && <span style={{ fontSize: 9, padding: "2px 8px", background: "rgba(123,47,255,0.2)", border: `1px solid ${C.border2}`, borderRadius: 4, color: C.purpleL, fontFamily: C.raj, fontWeight: 700, letterSpacing: "1px", textTransform: "uppercase" }}>{game.category}</span>}
              {tournamentId && <span style={{ fontSize: 9, padding: "2px 8px", background: "rgba(255,183,0,0.15)", border: "1px solid rgba(255,183,0,0.3)", borderRadius: 4, color: C.gold, fontFamily: C.raj, fontWeight: 700, letterSpacing: "1px" }}>🏆 TOURNAMENT</span>}
            </div>
          </div>

          {/* Stats pills — desktop */}
          {!isMobile && (
            <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
              {[["🎮", totalPlays.toLocaleString(), "Plays"], ["👥", uniquePlayers, "Players"]].map(([icon, val, label]) => (
                <div key={label} style={{ padding: "6px 12px", background: "rgba(0,0,0,0.4)", border: `1px solid ${C.border}`, borderRadius: 8, textAlign: "center", backdropFilter: "blur(8px)" }}>
                  <div style={{ fontFamily: C.orb, fontSize: 13, fontWeight: 700, color: C.purpleL }}>{icon} {val}</div>
                  <div style={{ fontSize: 9, color: C.dimMore, fontFamily: C.raj, textTransform: "uppercase", letterSpacing: "1px" }}>{label}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── MAIN CONTENT ── */}
      <div style={{ padding: isMobile ? "12px 14px" : "16px 32px" }}>
        <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 300px", gap: 16 }}>

          {/* ── GAME IFRAME ── */}
          <div style={{ background: C.card, border: `1px solid ${C.border2}`, borderRadius: 14, overflow: "hidden", position: "relative" }}>
            {game.iframeUrl && !game.iframeUrl.includes("your-unity-game") ? (
              <GameFrame
                ref={iframeRef}
                url={game.iframeUrl}
                title={game.name}
                isMobile={isMobile}
                isFullscreen={isFullscreen}
                onToggleFullscreen={handleToggleFullscreen}
              />
            ) : (
              <div style={{ height: isMobile ? "75vw" : "calc(100vh - 54px - 160px)", minHeight: isMobile ? 300 : 480, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 16 }}>
                <div style={{ fontSize: 56, filter: "drop-shadow(0 0 20px rgba(123,47,255,0.5))" }}>🎮</div>
                <div style={{ fontFamily: C.raj, fontWeight: 700, fontSize: 14, color: C.dimMore }}>Game coming soon</div>
                <button onClick={() => { const s = Math.floor(Math.random() * 10000); setScore(s); submitScore(s); }}
                  style={{ padding: "11px 28px", background: "linear-gradient(135deg,#7B2FFF,#5a1fd4)", border: "none", borderRadius: 8, color: "#fff", fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: C.raj }}>
                  Simulate Game Over (Test)
                </button>
              </div>
            )}

            {/* Chain tags bar */}
            <div style={{ padding: "8px 14px", borderTop: `1px solid ${C.border}`, display: "flex", gap: 8, background: "rgba(0,0,0,0.3)" }}>
              {[chainName?.toUpperCase() || "ON-CHAIN", "ARCADE X"].map((t, i) => (
                <span key={i} style={{ fontSize: 9, padding: "3px 8px", background: i === 2 ? "rgba(123,47,255,0.15)" : "rgba(0,0,0,0.4)", border: `1px solid ${i === 2 ? C.border2 : C.border}`, borderRadius: 4, color: i === 2 ? C.purpleL : C.dimMore, fontFamily: C.raj, fontWeight: 700, letterSpacing: "1px" }}>{t}</span>
              ))}
              <span style={{ marginLeft: "auto", fontSize: 9, color: C.dimMore, fontFamily: C.raj, display: "flex", alignItems: "center" }}>⚡ On-Chain Gaming</span>
            </div>
          </div>

          {/* ── RIGHT SIDEBAR ── */}
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>

            {/* Score Card */}
            <div style={{ background: C.card, border: `1px solid ${C.border2}`, borderRadius: 12, padding: "16px 18px", position: "relative", overflow: "hidden" }}>
              <div style={{ position: "absolute", top: -30, right: -30, width: 120, height: 120, background: "radial-gradient(circle,rgba(123,47,255,0.2) 0%,transparent 70%)", borderRadius: "50%", pointerEvents: "none" }} />
              <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 2, background: "linear-gradient(90deg,#7B2FFF,#00d4ff)" }} />
              <div style={{ fontSize: 9, color: C.dimMore, textTransform: "uppercase", letterSpacing: "1.5px", fontFamily: C.raj, fontWeight: 700, marginBottom: 6 }}>Current Score</div>
              <div style={{ fontFamily: C.orb, fontWeight: 700, fontSize: 44, color: "#c4a0ff", letterSpacing: "-1px", lineHeight: 1, animation: score > 0 ? "scoreFlash 0.3s ease" : "none" }}>
                {score.toLocaleString()}
              </div>
              <div style={{ marginTop: 10, display: "flex", gap: 8 }}>
                <div style={{ flex: 1, padding: "6px 10px", background: "rgba(0,255,136,0.06)", border: "1px solid rgba(0,255,136,0.15)", borderRadius: 7, textAlign: "center" }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: C.green, fontFamily: C.raj }}>+{playerReward}</div>
                  <div style={{ fontSize: 9, color: C.dimMore, fontFamily: C.raj }}>You earn</div>
                </div>
                <div style={{ flex: 1, padding: "6px 10px", background: "rgba(123,47,255,0.06)", border: `1px solid ${C.border}`, borderRadius: 7, textAlign: "center" }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: C.purpleL, fontFamily: C.raj }}>+{creatorReward}</div>
                  <div style={{ fontSize: 9, color: C.dimMore, fontFamily: C.raj }}>Creator</div>
                </div>
              </div>
            </div>

            {/* Creator Card */}
            <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: "12px 16px" }}>
              <div style={{ fontSize: 9, color: C.dimMore, textTransform: "uppercase", letterSpacing: "1.5px", fontFamily: C.raj, fontWeight: 700, marginBottom: 10 }}>Creator</div>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <DiceBearAvatar address={game.creator || "arcade"} size={38} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: "#d4b8ff", fontFamily: C.raj, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {creatorProfile?.displayName
                      ? `${creatorProfile.displayName}.arcade`
                      : shortAddr(game.creator)}
                  </div>
                  {creatorProfile?.displayName && (
                    <div style={{ fontSize: 9, color: C.dimMore, fontFamily: "monospace" }}>{shortAddr(game.creator)}</div>
                  )}
                </div>
                {creatorProfile?.displayName && (
                  <span style={{ fontSize: 8, padding: "2px 6px", background: "rgba(0,212,255,0.1)", border: "1px solid rgba(0,212,255,0.2)", borderRadius: 4, color: C.cyan, fontFamily: C.raj, fontWeight: 700 }}>NFT ✓</span>
                )}
              </div>
              {/* Game info */}
              <div style={{ marginTop: 10, paddingTop: 10, borderTop: `1px solid ${C.border}`, display: "flex", flexDirection: "column", gap: 5 }}>
                {[["Category", game.category || "—"], ["Reward Rate", `${rewardRate} ${rewardSymbol}/play`], ["Total Plays", totalPlays.toLocaleString()], ["Unique Players", uniquePlayers]].map(([k, v]) => (
                  <div key={k} style={{ display: "flex", justifyContent: "space-between", fontSize: 11 }}>
                    <span style={{ color: C.dimMore, fontFamily: C.raj }}>{k}</span>
                    <span style={{ color: "#9977cc", fontFamily: C.raj, fontWeight: 600 }}>{v}</span>
                  </div>
                ))}
              </div>
              {/* Min score to claim reward — admin-set per-game (on-chain gameMinScore) */}
              {minScore !== null && (
                <div style={{ marginTop: 10, padding: "9px 12px", borderRadius: 8, background: "rgba(0,255,136,0.06)", border: "1px solid rgba(0,255,136,0.22)", display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontSize: 14 }}>🎯</span>
                  <span style={{ fontFamily: C.raj, fontSize: 11.5, fontWeight: 700, color: "#8effc4", lineHeight: 1.35 }}>
                    {minScore > 0
                      ? <>Score min <b style={{ color: "#00FF88" }}>{minScore.toLocaleString()}</b> pts to claim {rewardSymbol}</>
                      : <>No minimum — any score earns {rewardSymbol}</>}
                  </span>
                </div>
              )}
            </div>

            {/* TX status */}
            {submitting && (
              <div style={{ background: "rgba(123,47,255,0.06)", border: `1px solid ${C.border2}`, borderRadius: 10, padding: "13px 16px", textAlign: "center" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, marginBottom: 5 }}>
                  <div style={{ width: 8, height: 8, borderRadius: "50%", background: C.purple, animation: "lbPulse 1s ease-in-out infinite" }} />
                  <div style={{ fontFamily: C.raj, fontSize: 13, fontWeight: 700, color: "#a67fff" }}>Writing on chain...</div>
                </div>
                <div style={{ fontSize: 10, color: C.dimMore, fontFamily: C.raj }}>Approve in your wallet</div>
                <div style={{ fontSize: 9.5, color: C.dimMore, fontFamily: C.raj, marginTop: 3, opacity: 0.85 }}>Keep this page open — don't refresh</div>
              </div>
            )}

            {/* ── Professional error card ── */}
            {renderErrorCard()}

            {submitted && txHash && (
              <div style={{ background: "rgba(0,255,136,0.05)", border: "1px solid rgba(0,255,136,0.15)", borderRadius: 10, padding: "14px 16px" }}>
                <div style={{ fontFamily: C.raj, fontWeight: 700, fontSize: 12, color: C.green, marginBottom: 5 }}>✓ Score submitted on-chain!</div>
                {tokensEarned > 0 && <div style={{ fontFamily: C.raj, fontWeight: 700, fontSize: 16, color: C.green, marginBottom: 6 }}>+{tokensEarned} {rewardSymbol} earned! 🎉</div>}
                <a href={`${explorerUrl || "https://scan.botchain.ai"}/tx/${txHash}`} target="_blank" rel="noreferrer" style={{ fontSize: 10, color: "#a67fff", textDecoration: "none", fontFamily: C.raj, fontWeight: 700 }}>View on {chainName} Explorer →</a>
              </div>
            )}
            {score > 0 && !submitted && !submitting && (
              <button onClick={() => submitScore(score)} disabled={!isConnected}
                style={{ padding: "12px", background: "linear-gradient(135deg,#7B2FFF,#5a1fd4)", border: "none", borderRadius: 9, color: "#fff", fontSize: 12, fontWeight: 700, cursor: isConnected ? "pointer" : "not-allowed", fontFamily: C.raj, letterSpacing: "1px", textTransform: "uppercase", opacity: isConnected ? 1 : 0.5 }}>
                ⛓ Submit Score On-Chain
              </button>
            )}

            {/* Community card */}
            <div style={{ background: C.card, border: `1px solid ${C.border2}`, borderRadius: 12, overflow: "hidden" }}>
              {/* Header */}
              <div style={{ padding: "11px 14px", borderBottom: `1px solid ${C.border}`, background: "rgba(123,47,255,0.05)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                  <span style={{ fontSize: 13 }}>💬</span>
                  <span style={{ fontFamily: C.raj, fontWeight: 700, fontSize: 12, color: "#c4a0ff", textTransform: "uppercase", letterSpacing: "1px" }}>Community</span>
                </div>
                <span style={{ fontSize: 9, color: C.dimMore, fontFamily: C.raj }}>{comments.length} comments</span>
              </div>

              {/* Like bar */}
              <div style={{ padding: "9px 14px", borderBottom: `1px solid ${C.border}`, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <button className="like-btn" onClick={handleLike} disabled={!address}
                  style={{ display: "flex", alignItems: "center", gap: 7, padding: "6px 12px", background: liked ? "rgba(255,100,100,0.12)" : "rgba(123,47,255,0.06)", border: `1px solid ${liked ? "rgba(255,100,100,0.3)" : C.border}`, borderRadius: 18, cursor: liked ? "default" : "pointer", fontFamily: C.raj, fontWeight: 700, fontSize: 11, color: liked ? "#ff6b6b" : "#9977cc", transition: "all 0.2s" }}>
                  <span style={{ fontSize: 14, animation: liked ? "heartBeat 0.4s ease" : "none" }}>{liked ? "❤️" : "🤍"}</span>
                  {liked ? "Liked!" : "Like"}
                </button>
                <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                  <span style={{ fontSize: 13 }}>❤️</span>
                  <span style={{ fontFamily: C.orb, fontWeight: 700, fontSize: 12, color: "#ff6b6b" }}>{likeCount}</span>
                </div>
              </div>

              {/* Comment input */}
              {address ? (
                <div style={{ padding: "9px 14px", borderBottom: `1px solid ${C.border}`, display: "flex", gap: 7, alignItems: "center" }}>
                  <DiceBearAvatar address={address} size={26} />
                  <input className="comment-input" value={commentText} onChange={e => setCommentText(e.target.value)}
                    onKeyDown={e => e.key === "Enter" && !e.shiftKey && handleComment()}
                    placeholder="Share your thoughts..." maxLength={200}
                    style={{ flex: 1, padding: "7px 11px", background: "rgba(123,47,255,0.06)", border: `1px solid ${C.border}`, borderRadius: 18, color: "#d4b8ff", fontSize: 12, fontFamily: C.raj, transition: "border-color 0.18s" }} />
                  <button className="send-btn" onClick={handleComment} disabled={postingComment || !commentText.trim()}
                    style={{ width: 30, height: 30, borderRadius: "50%", background: "linear-gradient(135deg,#7B2FFF,#5a1fd4)", border: "none", color: "#fff", fontSize: 13, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, transition: "all 0.18s" }}>
                    {postingComment ? "·" : "↑"}
                  </button>
                </div>
              ) : (
                <div style={{ padding: "10px 14px", borderBottom: `1px solid ${C.border}`, textAlign: "center", fontSize: 11, color: C.dimMore, fontFamily: C.raj }}>Connect wallet to comment</div>
              )}

              {/* Comments list */}
              <div style={{ maxHeight: 200, overflowY: "auto" }}>
                {commentsLoading ? (
                  <div style={{ padding: 20, textAlign: "center", fontSize: 10, color: C.dimMore, fontFamily: C.raj }}>Loading...</div>
                ) : comments.length === 0 ? (
                  <div style={{ padding: "20px 14px", textAlign: "center" }}>
                    <div style={{ fontSize: 22, marginBottom: 6 }}>💬</div>
                    <div style={{ fontSize: 11, color: C.dimMore, fontFamily: C.raj }}>No comments yet — be first!</div>
                  </div>
                ) : comments.map((c, i) => (
                  <div key={c.id} className="comment-row" style={{ padding: "9px 14px", borderBottom: i < comments.length - 1 ? `1px solid rgba(123,47,255,0.06)` : "none", animation: "slideIn 0.2s ease", transition: "background 0.15s" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 3 }}>
                      <DiceBearAvatar address={c.player} size={22} />
                      <span style={{ fontSize: 11, fontFamily: "monospace", fontWeight: 700, background: "linear-gradient(90deg,#7B2FFF,#00d4ff)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>{shortAddr(c.player)}</span>
                      <span style={{ fontSize: 9, color: "#3a2a5a", fontFamily: C.raj }}>{timeAgo(c.createdAt)}</span>
                    </div>
                    <div style={{ fontSize: 12, color: "#c4a0ff", fontFamily: C.raj, lineHeight: 1.5, wordBreak: "break-word", paddingLeft: 29 }}>{c.text}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* Powered by */}
            <div style={{ textAlign: "center", padding: "6px 0", animation: "poweredGlow 3s ease-in-out infinite" }}>
              <div style={{ fontSize: 10, fontFamily: C.raj, fontWeight: 700, letterSpacing: "1.5px", textTransform: "uppercase", background: "linear-gradient(90deg,#7B2FFF,#00d4ff)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>⚡ Powered by ArcadeX</div>
              <div style={{ fontSize: 9, color: "#3a2a5a", fontFamily: C.raj, letterSpacing: "1px", marginTop: 1 }}>On-Chain Gaming</div>
            </div>

          </div>
        </div>
      </div>

      {showHelpModal && (
        <div onClick={() => setShowHelpModal(false)} style={{ position: "fixed", inset: 0, zIndex: 1000, background: "rgba(0,0,0,0.88)", backdropFilter: "blur(6px)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20, animation: "fadeIn 0.18s ease" }}>
          <style>{`
            @keyframes fadeIn { from { opacity: 0 } to { opacity: 1 } }
            @keyframes modalSlide { from { opacity: 0; transform: translateY(18px) scale(0.97) } to { opacity: 1; transform: translateY(0) scale(1) } }
            @keyframes headerGlow { 0%,100% { opacity: 1 } 50% { opacity: 0.7 } }
            .help-section:not(:last-child) { border-bottom: 1px solid rgba(123,47,255,0.1); margin-bottom: 0; padding-bottom: 16px; }
          `}</style>

          <div onClick={e => e.stopPropagation()} style={{
            background: "linear-gradient(160deg, #0f0d20 0%, #0a0815 100%)",
            border: `1px solid rgba(123,47,255,0.35)`,
            borderRadius: 18,
            width: "100%", maxWidth: 500,
            maxHeight: "82vh", overflowY: "auto",
            position: "relative",
            animation: "modalSlide 0.22s cubic-bezier(0.34,1.56,0.64,1)",
            boxShadow: "0 0 60px rgba(123,47,255,0.25), 0 24px 80px rgba(0,0,0,0.8)",
          }}>

            {/* Top accent bar — animated gradient */}
            <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 3, borderRadius: "18px 18px 0 0", background: "linear-gradient(90deg, #7B2FFF, #00D4FF, #00FF88, #7B2FFF)", backgroundSize: "200% 100%", animation: "gradientShift 3s linear infinite" }} />
            <style>{`@keyframes gradientShift { 0%{background-position:0% 0%} 100%{background-position:200% 0%} }`}</style>

            {/* Glow orb top-right */}
            <div style={{ position: "absolute", top: -40, right: -40, width: 160, height: 160, background: "radial-gradient(circle, rgba(123,47,255,0.18) 0%, transparent 70%)", borderRadius: "50%", pointerEvents: "none" }} />

            {/* Header */}
            <div style={{ padding: "22px 24px 16px", borderBottom: `1px solid rgba(123,47,255,0.15)`, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div style={{ width: 34, height: 34, borderRadius: 10, background: "rgba(123,47,255,0.18)", border: "1px solid rgba(123,47,255,0.3)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16 }}>❓</div>
                <div>
                  <div style={{ fontFamily: C.raj, fontWeight: 700, fontSize: 17, color: "#fff", lineHeight: 1 }}>How to Play</div>
                  <div style={{ fontFamily: C.raj, fontSize: 10, color: C.dimMore, marginTop: 2, letterSpacing: "0.5px" }}>{game.name}</div>
                </div>
              </div>
              <button onClick={() => setShowHelpModal(false)} style={{ background: "rgba(255,255,255,0.05)", border: `1px solid rgba(123,47,255,0.2)`, borderRadius: 8, color: C.dimMore, fontSize: 18, width: 32, height: 32, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", transition: "all 0.15s", fontFamily: C.raj }}>✕</button>
            </div>

            {/* Sections */}
            <div style={{ padding: "18px 24px 22px", display: "flex", flexDirection: "column", gap: 16 }}>

              {game.helpContent?.objective && (
                <div className="help-section">
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 9 }}>
                    <div style={{ width: 3, height: 18, borderRadius: 2, background: C.cyan, flexShrink: 0 }} />
                    <span style={{ fontSize: 10, color: C.cyan, fontFamily: C.raj, fontWeight: 700, textTransform: "uppercase", letterSpacing: "2px" }}>🎯 Objective</span>
                  </div>
                  <div style={{ fontSize: 13, color: "#e8deff", fontFamily: C.raj, lineHeight: 1.7, whiteSpace: "pre-wrap", paddingLeft: 11 }}>{game.helpContent.objective}</div>
                </div>
              )}

              {game.helpContent?.controls && (
                <div className="help-section">
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 9 }}>
                    <div style={{ width: 3, height: 18, borderRadius: 2, background: C.green, flexShrink: 0 }} />
                    <span style={{ fontSize: 10, color: C.green, fontFamily: C.raj, fontWeight: 700, textTransform: "uppercase", letterSpacing: "2px" }}>🎮 Controls</span>
                  </div>
                  <div style={{ fontSize: 13, color: "#e8deff", fontFamily: C.raj, lineHeight: 1.7, whiteSpace: "pre-wrap", paddingLeft: 11 }}>{game.helpContent.controls}</div>
                </div>
              )}

              {game.helpContent?.instructions && (
                <div className="help-section">
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 9 }}>
                    <div style={{ width: 3, height: 18, borderRadius: 2, background: C.gold, flexShrink: 0 }} />
                    <span style={{ fontSize: 10, color: C.gold, fontFamily: C.raj, fontWeight: 700, textTransform: "uppercase", letterSpacing: "2px" }}>📋 Instructions</span>
                  </div>
                  <div style={{ fontSize: 13, color: "#e8deff", fontFamily: C.raj, lineHeight: 1.7, whiteSpace: "pre-wrap", paddingLeft: 11 }}>{game.helpContent.instructions}</div>
                </div>
              )}

              {game.helpContent?.tips && (
                <div className="help-section">
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 9 }}>
                    <div style={{ width: 3, height: 18, borderRadius: 2, background: C.purpleL, flexShrink: 0 }} />
                    <span style={{ fontSize: 10, color: C.purpleL, fontFamily: C.raj, fontWeight: 700, textTransform: "uppercase", letterSpacing: "2px" }}>💡 Tips</span>
                  </div>
                  <div style={{ fontSize: 13, color: "#e8deff", fontFamily: C.raj, lineHeight: 1.7, whiteSpace: "pre-wrap", paddingLeft: 11 }}>{game.helpContent.tips}</div>
                </div>
              )}

              {game.helpContent?.videoUrl && (
                <div className="help-section">
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 9 }}>
                    <div style={{ width: 3, height: 18, borderRadius: 2, background: "#FF6B6B", flexShrink: 0 }} />
                    <span style={{ fontSize: 10, color: "#FF6B6B", fontFamily: C.raj, fontWeight: 700, textTransform: "uppercase", letterSpacing: "2px" }}>▶️ Tutorial</span>
                  </div>
                  <a href={game.helpContent.videoUrl} target="_blank" rel="noreferrer"
                    style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "8px 14px", background: "rgba(255,107,107,0.08)", border: "1px solid rgba(255,107,107,0.2)", borderRadius: 8, color: "#FF6B6B", fontSize: 12, fontFamily: C.raj, fontWeight: 700, textDecoration: "none", marginLeft: 11 }}>
                    ▶ Watch Tutorial →
                  </a>
                </div>
              )}

            </div>
          </div>
        </div>
      )}

      {/* ── Score-submit overlay (renders across everything, incl. fake FS) ── */}
      {renderSubmitOverlay()}

      {/* ── TaskOn polling overlay (mutually exclusive with above) ── */}
      {renderTaskonOverlay()}
    </div>
  );
}