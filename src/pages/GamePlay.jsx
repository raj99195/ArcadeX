import { useParams, useNavigate, useLocation } from "react-router-dom";
import { useEffect, useState, useRef } from "react";
import { useAccount, usePublicClient } from "wagmi";
import { writeContract, waitForTransactionReceipt, readContract } from "@wagmi/core";
import { keccak256, toHex } from "viem";
import { wagmiAdapter } from "../Providers";
import { useGames } from "../hooks/useGames";
import { saveScore } from "../lib/gameService";
import { useChain } from "../context/ChainContext";
import { getActiveAvatarStyle } from "../utils/avatarUtils";
import { useArcadeBalance } from "../hooks/useArcadeBalance";

const TOURNAMENT_SCORE_ABI = [{ name: "submitTournamentScore", type: "function", stateMutability: "nonpayable", inputs: [{ name: "tournamentId", type: "uint256" }, { name: "score", type: "uint256" }, { name: "nonce", type: "uint256" }, { name: "signature", type: "bytes" }], outputs: [] }];
const PLATFORM_ABI = [{ name: "recordPlayAndEarn", type: "function", stateMutability: "nonpayable", inputs: [{ name: "gameId", type: "uint256" }, { name: "score", type: "uint256" }, { name: "nonce", type: "uint256" }, { name: "signature", type: "bytes" }], outputs: [] }];
const PLATFORM_READ_ABI = [
  { name: "games", type: "function", stateMutability: "view", inputs: [{ name: "", type: "uint256" }], outputs: [{ name: "gameId", type: "uint256" }, { name: "name", type: "string" }, { name: "creator", type: "address" }, { name: "iframeUrl", type: "string" }, { name: "rewardRate", type: "uint256" }, { name: "totalPlays", type: "uint256" }, { name: "isActive", type: "bool" }] },
  { name: "playerSharePercent", type: "function", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint256" }] },
  { name: "creatorSharePercent", type: "function", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint256" }] },
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

  const [score, setScore] = useState(0);
  const [showHelpModal, setShowHelpModal] = useState(false);
  const [isFakeFullscreen, setIsFakeFullscreen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [txHash, setTxHash] = useState("");
  const [submitError, setSubmitError] = useState(null); // null | { type, icon, title, msg }
  const [gameLoading, setGameLoading] = useState(true);
  const [tokensEarned, setTokensEarned] = useState(0);
  const [totalPlays, setTotalPlays] = useState(0);
  const [uniquePlayers, setUniquePlayers] = useState(0);
  const [creatorProfile, setCreatorProfile] = useState(null);
  const [liked, setLiked] = useState(false);
  const [likeCount, setLikeCount] = useState(0);
  const [playerSplit, setPlayerSplit] = useState(80);
  const [creatorSplit, setCreatorSplit] = useState(20);
  const [comments, setComments] = useState([]);
  const [commentText, setCommentText] = useState("");
  const [postingComment, setPostingComment] = useState(false);
  const [commentsLoading, setCommentsLoading] = useState(true);

  const iframeRef = useRef(null);
  const submittingRef = useRef(false);
  const sessionTokenRef = useRef(null); // SH0009: gameplay session token
  const { balance } = useArcadeBalance();

  useEffect(() => {
    const h = () => setIsMobile(window.innerWidth <= 768);
    window.addEventListener("resize", h);
    return () => window.removeEventListener("resize", h);
  }, []);

  // SH0003: ESC exits fake fullscreen (desktop convenience)
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
    })();
  }, [PLATFORM_ADDRESS, publicClient]);

  useEffect(() => {
    if (!gameId || !address) return;
    setLiked(!!localStorage.getItem(`liked_game_${gameId}_${address}`));
  }, [gameId, address]);

  // Fetch game stats via API
  useEffect(() => {
    if (!game) return;
    const fetchStats = async () => {
      try {
        const res = await fetch(`/api/games?action=stats&gameId=${game.gameId || game.id}`);
        const data = await res.json();
        setTotalPlays(data.plays || 0);
        setUniquePlayers(data.uniquePlayers || 0);
        setComments(data.comments || []);
        setCommentsLoading(false);
      } catch (e) {}
    };
    fetchStats();
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
        setScore(sc);
      }
      if (event.data?.type === "GAME_OVER") {
        const sc = Number(event.data.score);
        if (!Number.isFinite(sc) || sc < 0) return; // garbage score ignore
        setScore(sc); setSubmitted(false); setTxHash(""); setSubmitError(null); submittingRef.current = false;
        submitScore(sc);
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

  const submitScore = async (finalScore) => {
    if (submittingRef.current || !address || !game) return;
    submittingRef.current = true;
    setSubmitting(true); setSubmitError(null);
    try {
      const onChainGameId = game.gameId;
      if (!onChainGameId) throw new Error("Game not registered on-chain");
      const rewardRate = (isNativeToken ? game.rewardRateNative : game.rewardRate) || (isNativeToken ? 1 : 50);
      // Math.floor() was rounding native-chain estimates (rate 1-2) straight
      // to 0 — 80% of 1 is 0.8, floors to 0. Round to 2 decimals instead so
      // small native-token amounts still show up.
      const playerReward = Math.round(rewardRate * playerSplit / 100 * 100) / 100;

      // SH0009: session token required — no fallback, hard block karo
      const _jwt = localStorage.getItem("arcadex_jwt");
      const _session = sessionTokenRef.current;

      if (!_jwt) {
        setSubmitError({ type: "auth", soft: false, icon: "🔐", title: "Not Signed In", msg: "Please connect your wallet and sign in to submit scores." });
        setSubmitting(false); submittingRef.current = false; return;
      }
      if (!_session) {
        setSubmitError({ type: "session", soft: true, icon: "🔄", title: "Session Expired", msg: "Your game session has expired. Please reload the page and play again." });
        setSubmitting(false); submittingRef.current = false; return;
      }

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
          setSubmitError({ type: "session", soft: false, icon: "🔐", title: "Score Verification Failed", msg: errData.error || "Could not verify gameplay session. Reload the page and try again." });
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
        setSubmitError({ type: "session", soft: false, icon: "🔐", title: "Score Verification Failed", msg: "Network error while verifying score. Please try again." });
        setSubmitting(false); submittingRef.current = false; return;
      }

      const hash = await writeContract(wagmiAdapter.wagmiConfig, {
        address: PLATFORM_ADDRESS, abi: PLATFORM_ABI,
        functionName: "recordPlayAndEarn",
        args: [BigInt(onChainGameId), BigInt(finalScore), nonce, signature],
        gas: BigInt(500000),
        chainId: CHAIN_ID,
      });
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
    } catch (err) {
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

  // ── Error card helper — called in JSX ────────────────────────────────────
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
              <>
                <iframe ref={iframeRef} src={game.iframeUrl}
                  style={{ width: "100%", height: isMobile ? "75vw" : "calc(100vh - 54px - 160px)", minHeight: isMobile ? 300 : 480, border: "none", display: "block" }}
                  allow="fullscreen" allowFullScreen title={game.name} />
                {/* SH0003: iOS Safari blocks iframe.requestFullscreen entirely.
                    Fake fullscreen: fixed-position overlay covering full viewport.
                    Works on iOS, Android, and desktop. ESC key also exits on desktop. */}
                <button onClick={() => {
                  const iframe = iframeRef.current;
                  // Try native fullscreen first (desktop Chrome/Firefox/Edge)
                  const nativeFS = iframe?.requestFullscreen || iframe?.webkitRequestFullscreen;
                  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
                  if (!isIOS && nativeFS) {
                    try {
                      nativeFS.call(iframe);
                      return;
                    } catch (e) { /* fallthrough to fake fullscreen */ }
                  }
                  // iOS / native FS unavailable → CSS fake fullscreen
                  setIsFakeFullscreen(fs => !fs);
                }} style={{ position: "absolute", bottom: 10, right: 10, padding: "6px 12px", background: "rgba(0,0,0,0.8)", border: `1px solid ${C.border2}`, borderRadius: 7, color: "#a67fff", fontSize: 11, cursor: "pointer", fontFamily: C.raj, fontWeight: 700, backdropFilter: "blur(8px)", display: "flex", alignItems: "center", gap: 5 }}>
                  <span>{isFakeFullscreen ? "✕" : "⛶"}</span> {isFakeFullscreen ? "Exit" : "Fullscreen"}
                </button>

                {/* Fake fullscreen overlay — fixed, full viewport, highest z-index */}
                {isFakeFullscreen && (
                  <div style={{ position: "fixed", inset: 0, zIndex: 9999, background: "#000", display: "flex", flexDirection: "column" }}>
                    <iframe src={game.iframeUrl}
                      style={{ flex: 1, width: "100%", border: "none", display: "block" }}
                      allow="fullscreen" allowFullScreen title={game.name} />
                    <button onClick={() => setIsFakeFullscreen(false)}
                      style={{ position: "absolute", top: 12, right: 12, padding: "6px 14px", background: "rgba(0,0,0,0.85)", border: `1px solid ${C.border2}`, borderRadius: 7, color: "#a67fff", fontSize: 12, cursor: "pointer", fontFamily: C.raj, fontWeight: 700, zIndex: 10000 }}>
                      ✕ Exit
                    </button>
                  </div>
                )}
              </>
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
    </div>
  );
}