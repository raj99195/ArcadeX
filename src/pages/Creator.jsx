import { useState, useEffect } from "react";
import { useAccount, usePublicClient } from "wagmi";
import { useNavigate } from "react-router-dom";
import { saveGame, saveCreator, getGamesByCreator, registerCreator, getCreatorStatus, getGameById } from "../lib/gameService";
import { useArcadeBalance } from "../hooks/useArcadeBalance";
import { writeContract, waitForTransactionReceipt } from "@wagmi/core";
import { wagmiAdapter } from "../Providers";
import { useChain } from "../context/ChainContext";

// PLATFORM_ADDRESS, CHAIN_ID, CREATOR_NFT_ADDRESS, TOURNAMENT_ADDRESS,
// ARCADE_TOKEN_ADDRESS all now come from useChain() inside the component
// (see src/context/ChainContext.jsx) — no more reading import.meta.env
// or hardcoding a single chain's addresses at module scope.

const PLATFORM_ABI = [
  { name: "initCreator", type: "function", stateMutability: "nonpayable", inputs: [{ name: "creator", type: "address" }], outputs: [] },
  { name: "registerGame", type: "function", stateMutability: "nonpayable", inputs: [{ name: "name", type: "string" }, { name: "iframeUrl", type: "string" }, { name: "rewardRate", type: "uint256" }], outputs: [] },
  { name: "getTotalGames", type: "function", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint256" }] },
  { name: "getCreatorStats", type: "function", stateMutability: "view", inputs: [{ name: "creator", type: "address" }], outputs: [{ name: "totalEarned", type: "uint256" }, { name: "gamesPublished", type: "uint256" }, { name: "isVerified", type: "bool" }] },
];

const NFT_ABI = [
  { name: "mintCreatorNFT", type: "function", stateMutability: "nonpayable", inputs: [{ name: "username", type: "string" }, { name: "avatarColor", type: "string" }], outputs: [] },
  { name: "isUsernameAvailable", type: "function", stateMutability: "view", inputs: [{ name: "username", type: "string" }], outputs: [{ name: "", type: "bool" }] },
  { name: "walletToToken", type: "function", stateMutability: "view", inputs: [{ name: "", type: "address" }], outputs: [{ name: "", type: "uint256" }] },
  { 
    name: "getProfile", 
    type: "function", 
    stateMutability: "view", 
    inputs: [{ name: "wallet", type: "address" }], 
    outputs: [
      { name: "username", type: "string" },
      { name: "avatarColor", type: "string" },
      { name: "wallet", type: "address" },
      { name: "mintedAt", type: "uint256" }
    ]
  },
];
const P = {
  p: "#7B2FFF", p2: "rgba(123,47,255,0.15)", p3: "rgba(123,47,255,0.07)",
  pb: "rgba(123,47,255,0.22)", bg: "#08070f", s1: "#0e0c1a", s2: "#12101f",
  b: "rgba(123,47,255,0.12)", b2: "rgba(123,47,255,0.25)",
  raj: "'Rajdhani',sans-serif", orb: "'Orbitron',sans-serif",
};

// Shared form field styles — used by every <label>/<input>/<textarea>/<select> below
const labelStyle = {
  display: "block", fontSize: 11, fontWeight: 700, color: "#9977cc",
  marginBottom: 6, fontFamily: P.raj, textTransform: "uppercase", letterSpacing: "0.5px",
};
const inputStyle = {
  width: "100%", boxSizing: "border-box", padding: "10px 12px",
  background: "rgba(123,47,255,0.05)", border: `1px solid ${P.b}`, borderRadius: 8,
  color: "#e0d4ff", fontSize: 13, fontFamily: P.raj, outline: "none",
};

const statusMap = {
  approved: { bg: "rgba(0,255,136,0.08)", color: "#00FF88", border: "rgba(0,255,136,0.2)", label: "✓ Live" },
  pending: { bg: "rgba(255,184,0,0.08)", color: "#FFB800", border: "rgba(255,184,0,0.2)", label: "⏳ Pending" },
  rejected: { bg: "rgba(255,68,68,0.08)", color: "#ff4444", border: "rgba(255,68,68,0.2)", label: "✗ Rejected" },
};

const CLOUDINARY_CLOUD = import.meta.env.VITE_CLOUDINARY_CLOUD_NAME;
const CLOUDINARY_PRESET = import.meta.env.VITE_CLOUDINARY_UPLOAD_PRESET;
// TOURNAMENT_ADDRESS and ARCADE_TOKEN_ADDRESS now come from useChain()

const TOURNAMENT_ABI = [
  { name: "createTournament", type: "function", stateMutability: "nonpayable", inputs: [{ name: "gameId", type: "uint256" }, { name: "gameName", type: "string" }, { name: "gameThumbnail", type: "string" }, { name: "entryFee", type: "uint256" }, { name: "maxPlayers", type: "uint256" }, { name: "startTime", type: "uint256" }, { name: "durationInHours", type: "uint256" }], outputs: [] },
  { name: "getTournamentInfo", type: "function", stateMutability: "view", inputs: [{ name: "tournamentId", type: "uint256" }], outputs: [{ name: "", type: "tuple", components: [{ name: "id", type: "uint256" }, { name: "gameId", type: "uint256" }, { name: "gameName", type: "string" }, { name: "gameThumbnail", type: "string" }, { name: "creator", type: "address" }, { name: "entryFee", type: "uint256" }, { name: "maxPlayers", type: "uint256" }, { name: "startTime", type: "uint256" }, { name: "endTime", type: "uint256" }, { name: "prizePool", type: "uint256" }, { name: "status", type: "uint8" }, { name: "players", type: "address[]" }, { name: "prizesDistributed", type: "bool" }] }] },
  { name: "nextTournamentId", type: "function", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint256" }] },
  { name: "endTournamentAndDistribute", type: "function", stateMutability: "nonpayable", inputs: [{ name: "tournamentId", type: "uint256" }], outputs: [] },
];

const ERC20_APPROVE_ABI = [
  { name: "approve", type: "function", stateMutability: "nonpayable", inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }], outputs: [{ name: "", type: "bool" }] },
];

const DICEBEAR_STYLES = [
  { id: "bottts",      label: "🤖 Robot",    desc: "Web3 vibe"    },
  { id: "pixel-art",   label: "👾 Pixel",    desc: "Arcade style" },
  { id: "adventurer",  label: "🧙 Gamer",    desc: "Cartoon"      },
  { id: "lorelei",     label: "🧝 Anime",    desc: "Anime-ish"    },
  { id: "fun-emoji",   label: "😎 Emoji",    desc: "Fun"          },
  { id: "identicon",   label: "🔷 Identicon",desc: "Minimal"      },
];

// ── Dynamic gas helper ──────────────────────────────────────────────────────
// Estimates real gas needed for a contract call on whichever chain is
// currently active, then adds a safety buffer. Works correctly across all
// chains in the registry — no more hardcoded per-chain gas guesswork that
// breaks (or wastes gas) when a new chain has different costs than BOTChain.
async function getGasWithBuffer(publicClient, { address, abi, functionName, args, account, bufferPct = 30 }) {
  try {
    const estimated = await publicClient.estimateContractGas({
      address, abi, functionName, args, account,
    });
    return (estimated * BigInt(100 + bufferPct)) / 100n;
  } catch (err) {
    console.warn(`Gas estimation failed for ${functionName}, using fallback:`, err.shortMessage || err.message);
    return BigInt(3000000);
  }
}

function Btn({ children, onClick, disabled, variant = "primary", style = {} }) {
  const base = { padding: "10px 20px", border: "none", borderRadius: 7, cursor: disabled ? "not-allowed" : "pointer", fontFamily: P.raj, fontWeight: 700, fontSize: 12, letterSpacing: "0.5px", textTransform: "uppercase", transition: "all 0.18s", ...style };
  const styles = {
    primary: { background: disabled ? "rgba(123,47,255,0.2)" : "linear-gradient(135deg,#7B2FFF,#5a1fd4)", color: disabled ? "#5533aa" : "#fff" },
    ghost: { background: "rgba(123,47,255,0.06)", border: "1px solid rgba(123,47,255,0.22)", color: "rgba(200,170,255,0.8)" },
    danger: { background: "rgba(255,68,68,0.08)", border: "1px solid rgba(255,68,68,0.2)", color: "#ff4444" },
  };
  return <button onClick={onClick} disabled={disabled} style={{ ...base, ...styles[variant] }}>{children}</button>;
}

function GameModal({ game, onClose }) {
  const { explorerUrl, chainName, rewardToken, isNativeToken } = useChain();
  const [copied, setCopied] = useState(false);
  const copy = (text) => { navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 2000); };
  if (!game) return null;
  const s = statusMap[game.status] || statusMap.pending;
  const displayRate = isNativeToken ? (game.rewardRateNative || 1) : (game.rewardRate || 50);
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 1000, background: "rgba(0,0,0,0.88)", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }} onClick={onClose}>
      <div style={{ background: P.s1, border: `1px solid ${P.b2}`, borderRadius: 14, padding: 28, width: "100%", maxWidth: 500, position: "relative", boxShadow: "0 24px 60px rgba(0,0,0,0.8)" }} onClick={e => e.stopPropagation()}>
        <button onClick={onClose} style={{ position: "absolute", top: 14, right: 14, background: "rgba(123,47,255,0.08)", border: "1px solid rgba(123,47,255,0.2)", borderRadius: 6, color: "#a67fff", fontSize: 12, padding: "4px 10px", cursor: "pointer", fontFamily: P.raj, fontWeight: 700 }}>✕ Close</button>
        {game.thumbnailUrl && <div style={{ marginBottom: 18, borderRadius: 8, overflow: "hidden", height: 130 }}><img src={game.thumbnailUrl} alt={game.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} /></div>}
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
          <div style={{ fontFamily: P.raj, fontWeight: 700, fontSize: 18, color: "#fff" }}>{game.name}</div>
          <span style={{ padding: "3px 9px", borderRadius: 4, fontSize: 9, fontWeight: 700, background: s.bg, color: s.color, border: `1px solid ${s.border}`, fontFamily: P.raj }}>{s.label}</span>
        </div>
        {game.description && <div style={{ fontSize: 12, color: "#9977cc", lineHeight: 1.6, marginBottom: 16, fontFamily: P.raj }}>{game.description}</div>}
        <div style={{ marginBottom: 18 }}>
          {[["Game ID", `#${game.gameId}`], ["Category", game.category], ["Reward Rate", `${displayRate} ${rewardToken || "ARCADE"} / play`], ["Creator Revenue", "20% of all rewards"]].map(([k, v]) => (
            <div key={k} style={{ display: "flex", justifyContent: "space-between", fontSize: 12, padding: "8px 0", borderBottom: `1px solid ${P.b}` }}>
              <span style={{ color: "#9977cc", fontFamily: P.raj }}>{k}</span>
              <span style={{ color: "#c4a0ff", fontFamily: P.raj, fontWeight: 600 }}>{v}</span>
            </div>
          ))}
        </div>
        <div style={{ background: P.bg, border: `1px solid ${P.b}`, borderRadius: 8, padding: 14, marginBottom: 12 }}>
          <div style={{ fontSize: 9, color: "#9977cc", marginBottom: 8, textTransform: "uppercase", letterSpacing: "1px", fontFamily: P.raj, fontWeight: 700 }}>Unity Integration</div>
          <div style={{ fontFamily: "monospace", fontSize: 11, color: "#9977cc", marginBottom: 8 }}>Application.ExternalCall("arcade_init", "{game.gameId}");</div>
          <button onClick={() => copy(`Application.ExternalCall("arcade_init", "${game.gameId}");`)} style={{ padding: "4px 12px", background: copied ? "rgba(0,255,136,0.08)" : "rgba(123,47,255,0.08)", border: `1px solid ${copied ? "rgba(0,255,136,0.2)" : P.b2}`, borderRadius: 5, color: copied ? "#00FF88" : "#a67fff", fontSize: 10, cursor: "pointer", fontFamily: P.raj, fontWeight: 700 }}>
            {copied ? "Copied!" : "Copy"}
          </button>
        </div>
        {game.txHash && explorerUrl && (
          <a href={`${explorerUrl}/tx/${game.txHash}`} target="_blank" rel="noreferrer" style={{ display: "block", textAlign: "center", padding: "10px", background: "rgba(123,47,255,0.08)", border: `1px solid ${P.b2}`, borderRadius: 8, color: "#a67fff", fontSize: 11, textDecoration: "none", fontFamily: P.raj, fontWeight: 700 }}>
            View on {chainName} Explorer →
          </a>
        )}
      </div>
    </div>
  );
}

function GateScreen({ icon, title, accent, sub, children }) {
  return (
    <div style={{ minHeight: "calc(100vh - 54px)", background: P.bg, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
      <div style={{ textAlign: "center", maxWidth: 480, width: "100%" }}>
        <div style={{ width: 72, height: 72, borderRadius: "50%", background: P.p2, border: `1px solid ${P.pb}`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 30, margin: "0 auto 24px", boxShadow: "0 0 30px rgba(123,47,255,0.2)" }}>{icon}</div>
        <h2 style={{ fontFamily: P.raj, fontWeight: 700, fontSize: 32, textTransform: "uppercase", letterSpacing: "-0.3px", marginBottom: 10, color: "#fff" }}>
          {title} {accent && <span style={{ background: "linear-gradient(90deg,#7B2FFF,#00d4ff)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>{accent}</span>}
        </h2>
        <p style={{ color: "#9977cc", fontSize: 13, marginBottom: 28, lineHeight: 1.75, fontFamily: P.raj }}>{sub}</p>
        {children}
      </div>
    </div>
  );
}

export default function Creator() {
  const [isMobile, setIsMobile] = useState(typeof window !== "undefined" ? window.innerWidth <= 768 : false);
  const { address, isConnected } = useAccount();
  const publicClient = usePublicClient();
  const navigate = useNavigate();
  const { balance } = useArcadeBalance();
  const { contracts, chainId: CHAIN_ID, chainName, rewardToken, minRewardRate, maxRewardRate, isNativeToken } = useChain();

  // Fixed ranges per token type — independent of which chain is currently
  // connected, since a creator publishing from BOTChain still needs to set
  // a sane native-chain rate for when the game later gets synced to MST.
  const ARCADE_MIN = 5, ARCADE_MAX = 500;
  const NATIVE_MIN = 1, NATIVE_MAX = 2;
  const PLATFORM_ADDRESS = contracts.platform;
  const CREATOR_NFT_ADDRESS = contracts.creatorNft;
  const TOURNAMENT_ADDRESS = contracts.tournament;
  const ARCADE_TOKEN_ADDRESS = contracts.token;

  const [activeTab, setActiveTab] = useState("my-games");
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [txHash, setTxHash] = useState("");
  const [newGameId, setNewGameId] = useState(null);
  const [error, setError] = useState("");
  const [myGames, setMyGames] = useState([]);
  const [gamesLoading, setGamesLoading] = useState(false);
  const [selectedGame, setSelectedGame] = useState(null);
  const [claimLoading, setClaimLoading] = useState(false);
  const [claimMsg, setClaimMsg] = useState("");
  const [creatorStatus, setCreatorStatus] = useState(null);
  const [creatorLoading, setCreatorLoading] = useState(false);
  const [form, setForm] = useState({ name: "", description: "", iframeUrl: "", thumbnailUrl: "", category: "Action", rewardRate: "50", rewardRateNative: "1" });
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const fileInputRef = { current: null };

  // Tournament states
  const [myTournaments, setMyTournaments] = useState([]);
  const [tournamentsLoading, setTournamentsLoading] = useState(false);
  const [showCreateTournament, setShowCreateTournament] = useState(false);
  const [tForm, setTForm] = useState({ gameId: "", entryFee: "100", maxPlayers: "10", durationInHours: "24" });
  const [tCreating, setTCreating] = useState(false);
  const [tMsg, setTMsg] = useState("");

  // NFT states
  const [nftProfile, setNftProfile] = useState(null);
  const [username, setUsername] = useState("");
  const [selectedStyle, setSelectedStyle] = useState("bottts");
  const [usernameAvailable, setUsernameAvailable] = useState(null);
  const [usernameChecking, setUsernameChecking] = useState(false);
  const [mintLoading, setMintLoading] = useState(false);
  const [mintError, setMintError] = useState("");

  const categories = ["Action", "Runner", "Shooter", "Fighting", "Strategy", "Tower Defense", "Puzzle", "Trivia", "Casual", "Idle / Clicker", "Simulation", "Adventure", "RPG", "Platformer", "Sports", "Racing", "Horror", "Music / Rhythm", "Card / Board"];
  const handleChange = (e) => setForm({ ...form, [e.target.name]: e.target.value });
  const validateUrl = (url) => { try { new URL(url); return true; } catch { return false; } };

  // Check if wallet has NFT
  const checkNFT = async () => {
  if (!address || !publicClient) return;
  try {
    const tokenId = await publicClient.readContract({
      address: CREATOR_NFT_ADDRESS,
      abi: NFT_ABI,
      functionName: "walletToToken",
      args: [address],
    });

    if (Number(tokenId) > 0) {
      // getProfile ki jagah profiles mapping directly read karo
      const profile = await publicClient.readContract({
        address: CREATOR_NFT_ADDRESS,
        abi: [{
          name: "profiles",
          type: "function",
          stateMutability: "view",
          inputs: [{ name: "tokenId", type: "uint256" }],
          outputs: [
            { name: "username", type: "string" },
            { name: "avatarColor", type: "string" },
            { name: "wallet", type: "address" },
            { name: "mintedAt", type: "uint256" }
          ]
        }],
        functionName: "profiles",
        args: [tokenId],
      });

      setNftProfile({ 
        username: profile[0], 
        avatarColor: profile[1], 
        tokenId: Number(tokenId) 
      });
      setCreatorStatus("approved");
    } else {
      setNftProfile(null);
    }
  } catch (err) { console.error(err); }
};

  const checkCreatorStatus = async () => {
    if (!address) return;
    setCreatorLoading(true);
    try {
      await checkNFT();
      const status = await getCreatorStatus(address);
      if (status && !nftProfile) setCreatorStatus(status.status);
      else if (!status && !nftProfile) setCreatorStatus(null);
    } catch (err) { console.error(err); }
    finally { setCreatorLoading(false); }
  };

  useEffect(() => { if (address) checkCreatorStatus(); }, [address]);

  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth <= 768);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Username availability check
  const checkUsername = async (name) => {
    if (name.length < 3) { setUsernameAvailable(null); return; }
    setUsernameChecking(true);
    try {
      const available = await publicClient.readContract({
        address: CREATOR_NFT_ADDRESS,
        abi: NFT_ABI,
        functionName: "isUsernameAvailable",
        args: [name],
      });
      setUsernameAvailable(available);
    } catch { setUsernameAvailable(null); }
    finally { setUsernameChecking(false); }
  };

  useEffect(() => {
    const timer = setTimeout(() => { if (username) checkUsername(username); }, 600);
    return () => clearTimeout(timer);
  }, [username]);

  // Mint NFT
  const mintNFT = async () => {
    if (!username || username.length < 3) { setMintError("Username must be at least 3 characters."); return; }
    if (!usernameAvailable) { setMintError("Username is already taken!"); return; }
    setMintError("");
    setMintLoading(true);
    try {
      // 1. Mint NFT — gas estimated dynamically per chain
      const mintArgs = [username, selectedStyle];
      const mintGas = await getGasWithBuffer(publicClient, {
        address: CREATOR_NFT_ADDRESS, abi: NFT_ABI,
        functionName: "mintCreatorNFT", args: mintArgs, account: address,
      });
      const hash = await writeContract(wagmiAdapter.wagmiConfig, {
        address: CREATOR_NFT_ADDRESS,
        abi: NFT_ABI,
        functionName: "mintCreatorNFT",
        args: mintArgs,
        gas: mintGas,
        chainId: CHAIN_ID,
      });
      await waitForTransactionReceipt(wagmiAdapter.wagmiConfig, { hash });

      // 2. initCreator on Platform — gas estimated dynamically per chain
      const initArgs = [address];
      const initGas = await getGasWithBuffer(publicClient, {
        address: PLATFORM_ADDRESS, abi: PLATFORM_ABI,
        functionName: "initCreator", args: initArgs, account: address,
      });
      await writeContract(wagmiAdapter.wagmiConfig, {
        address: PLATFORM_ADDRESS,
        abi: PLATFORM_ABI,
        functionName: "initCreator",
        args: initArgs,
        gas: initGas,
        chainId: CHAIN_ID,
      });

      // 3. Save to Firebase
      await registerCreator({ address, displayName: username });

      // 4. Refresh
      await checkNFT();
      setCreatorStatus("approved");
    } catch (err) {
      console.error(err);
      setMintError("Transaction failed: " + err.message);
    } finally { setMintLoading(false); }
  };

  const fetchMyGames = async () => {
    if (!address) return;
    setGamesLoading(true);
    try { setMyGames(await getGamesByCreator(address)); } catch (err) { console.error(err); }
    finally { setGamesLoading(false); }
  };

  useEffect(() => { if (address) fetchMyGames(); }, [address]);
  useEffect(() => { if (address && creatorStatus === "approved") fetchMyGames(); }, [address, creatorStatus]);

  const fetchMyTournaments = async () => {
    if (!address || !publicClient) return;
    setTournamentsLoading(true);
    try {
      const nextId = await publicClient.readContract({ address: TOURNAMENT_ADDRESS, abi: TOURNAMENT_ABI, functionName: "nextTournamentId" });
      const total = Number(nextId) - 1;
      if (total <= 0) { setMyTournaments([]); setTournamentsLoading(false); return; }
      const results = await Promise.all(
        Array.from({ length: total }, (_, i) =>
          publicClient.readContract({ address: TOURNAMENT_ADDRESS, abi: TOURNAMENT_ABI, functionName: "getTournamentInfo", args: [BigInt(i + 1)] })
        )
      );
      const mine = results
        .map(t => ({ ...t, id: Number(t.id), status: Number(t.status), startTime: Number(t.startTime), endTime: Number(t.endTime), prizePool: t.prizePool, players: t.players }))
        .filter(t => t.creator?.toLowerCase() === address?.toLowerCase());
      setMyTournaments(mine);
    } catch (err) { console.error(err); }
    finally { setTournamentsLoading(false); }
  };

  useEffect(() => { if (address && creatorStatus === "approved") fetchMyTournaments(); }, [address, creatorStatus]);

  const handleCreateTournament = async () => {
    if (!tForm.gameId) return;
    setTCreating(true);
    setTMsg("");
    try {
      const selGame = myGames.find(g => String(g.id) === String(tForm.gameId));
      if (!selGame) throw new Error("Game not found");

      // gameId must be on-chain numeric gameId, not Firestore doc id
      const onChainGameId = selGame.gameId || selGame.id;

      const startTime = BigInt(Math.floor(Date.now() / 1000) + 60);
      const entryFeeWei = BigInt(Math.floor(Number(tForm.entryFee) * 1e18));

      const createArgs = [
        BigInt(onChainGameId),
        selGame.name,
        selGame.thumbnailUrl || "",
        entryFeeWei,
        BigInt(tForm.maxPlayers),
        startTime,
        BigInt(tForm.durationInHours),
      ];
      const createGas = await getGasWithBuffer(publicClient, {
        address: TOURNAMENT_ADDRESS, abi: TOURNAMENT_ABI,
        functionName: "createTournament", args: createArgs, account: address,
      });

      const hash = await writeContract(wagmiAdapter.wagmiConfig, {
        address: TOURNAMENT_ADDRESS,
        abi: TOURNAMENT_ABI,
        functionName: "createTournament",
        args: createArgs,
        gas: createGas,
        chainId: CHAIN_ID,
      });
      await waitForTransactionReceipt(wagmiAdapter.wagmiConfig, { hash });
      setTMsg("✓ Tournament created successfully!");
      setShowCreateTournament(false);
      setTForm({ gameId: "", entryFee: "100", maxPlayers: "10", durationInHours: "24" });
      await fetchMyTournaments();
    } catch (err) {
      console.error("Tournament create error:", err);
      setTMsg("Error: " + (err.shortMessage || err.message));
    }
    finally { setTCreating(false); }
  };

  const handleEndTournament = async (tournamentId) => {
    try {
      const endArgs = [BigInt(tournamentId)];
      const endGas = await getGasWithBuffer(publicClient, {
        address: TOURNAMENT_ADDRESS, abi: TOURNAMENT_ABI,
        functionName: "endTournamentAndDistribute", args: endArgs, account: address,
      });
      const hash = await writeContract(wagmiAdapter.wagmiConfig, {
        address: TOURNAMENT_ADDRESS,
        abi: TOURNAMENT_ABI,
        functionName: "endTournamentAndDistribute",
        args: endArgs,
        gas: endGas,
        chainId: CHAIN_ID,
      });
      await waitForTransactionReceipt(wagmiAdapter.wagmiConfig, { hash });
      setTMsg("🏆 Prizes distributed!");
      await fetchMyTournaments();
    } catch (err) {
      setTMsg("Error: " + (err.shortMessage || err.message));
    }
  };

  const uploadToCloudinary = async (file) => {
    if (!file) return null;
    setUploading(true);
    setUploadProgress(0);
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("upload_preset", CLOUDINARY_PRESET);
      formData.append("folder", "arcadex-games");
      const xhr = new XMLHttpRequest();
      const uploadUrl = `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD}/image/upload`;
      return await new Promise((resolve, reject) => {
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) setUploadProgress(Math.round((e.loaded / e.total) * 100));
        };
        xhr.onload = () => {
          if (xhr.status === 200) {
            const data = JSON.parse(xhr.responseText);
            resolve(data.secure_url);
          } else reject(new Error("Upload failed"));
        };
        xhr.onerror = () => reject(new Error("Upload failed"));
        xhr.open("POST", uploadUrl);
        xhr.send(formData);
      });
    } catch (err) {
      setError("Image upload failed: " + err.message);
      return null;
    } finally {
      setUploading(false);
      setUploadProgress(0);
    }
  };

const submitGame = async () => {
    if (!form.name || !form.iframeUrl || !form.description) { setError("Fill in all required fields."); return; }
    if (!validateUrl(form.iframeUrl)) { setError("Enter a valid game URL."); return; }
    if (!form.thumbnailUrl) { setError("Please upload a thumbnail image."); return; }
    setError("");
    setLoading(true);
    
    try {
      // 1. Reward Rate Safety Check — clamp both, each to its own fixed range
      const rr = parseInt(form.rewardRate);
      const safeRewardRate = Math.max(ARCADE_MIN, Math.min(ARCADE_MAX, isNaN(rr) ? 50 : rr));

      const rrNative = parseInt(form.rewardRateNative);
      const safeRewardRateNative = Math.max(NATIVE_MIN, Math.min(NATIVE_MAX, isNaN(rrNative) ? 1 : rrNative));

      // Whichever chain the creator is actually connected to right now is
      // the one this on-chain registerGame() call goes to — pick the
      // matching rate for that chain's token type.
      const rateForThisChain = isNativeToken ? safeRewardRateNative : safeRewardRate;

      // 2. Contract se total games nikalo
      const totalGames = await publicClient.readContract({ 
        address: PLATFORM_ADDRESS, 
        abi: PLATFORM_ABI, 
        functionName: "getTotalGames" 
      });
      const contractTotal = Number(totalGames);

      // 3. Register Game on-chain
      const registerArgs = [form.name, form.iframeUrl, BigInt(rateForThisChain)];
      const registerGas = await getGasWithBuffer(publicClient, {
        address: PLATFORM_ADDRESS, abi: PLATFORM_ABI,
        functionName: "registerGame", args: registerArgs, account: address,
      });

      const hash = await writeContract(wagmiAdapter.wagmiConfig, {
        address: PLATFORM_ADDRESS,
        abi: PLATFORM_ABI,
        functionName: "registerGame",
        args: registerArgs,
        gas: registerGas,
        chainId: CHAIN_ID,
      });
      await waitForTransactionReceipt(wagmiAdapter.wagmiConfig, { hash });

      // 4. Actual ID confirm karo
      const totalGamesAfter = await publicClient.readContract({ 
        address: PLATFORM_ADDRESS, 
        abi: PLATFORM_ABI, 
        functionName: "getTotalGames" 
      });
      const actualGameId = Number(totalGamesAfter);

      // 5. Firebase mein save — dono rates save karo, taaki baad me kisi
      // aur chain pe sync ho toh sahi rate uss chain ke liye already available ho
      await saveGame({ 
        gameId: actualGameId, 
        name: form.name, 
        description: form.description, 
        iframeUrl: form.iframeUrl, 
        thumbnailUrl: form.thumbnailUrl || "", 
        category: form.category, 
        rewardRate: safeRewardRate,             // ARCADE (ERC-20 chains)
        rewardRateNative: safeRewardRateNative, // native chains (MST)
        creator: address, 
        txHash: hash 
      });
      
      await saveCreator({ address, displayName: nftProfile?.username || address.slice(0, 8) });
      
      setNewGameId(actualGameId);
      setTxHash(hash);
      await fetchMyGames();
      setStep(3);
    } catch (err) {
      console.error("Submit error:", err);
      setError("Transaction failed: " + (err.message || err));
    } finally { 
      setLoading(false); 
    }
  };
  // STATE 1: Not connected
  if (!isConnected) return (
    <GateScreen icon="🎮" title="Creator" accent="Dashboard" sub={`Connect your wallet to publish games and earn ${rewardToken || "ARCADE"} tokens.`}>
      <div style={{ background: P.s1, border: `1px solid ${P.b}`, borderRadius: 10, padding: 16, fontSize: 12, color: "#9977cc", fontFamily: P.raj }}>
        Use the "Connect Wallet" button in the navbar to get started.
      </div>
    </GateScreen>
  );

  // STATE 2: No NFT — Mint screen
  if (!nftProfile) return (
    <div style={{ minHeight: "calc(100vh - 54px)", background: P.bg, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
      <div style={{ maxWidth: 500, width: "100%" }}>

        {/* Header */}
        <div style={{ textAlign: "center", marginBottom: 28 }}>
          <div style={{ width: 72, height: 72, borderRadius: "50%", background: P.p2, border: `1px solid ${P.pb}`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 30, margin: "0 auto 16px" }}>🎨</div>
          <h2 style={{ fontFamily: P.raj, fontWeight: 700, fontSize: 28, textTransform: "uppercase", color: "#fff", marginBottom: 8 }}>
            Mint Your <span style={{ background: "linear-gradient(90deg,#7B2FFF,#00d4ff)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>Creator NFT</span>
          </h2>
          <p style={{ color: "#9977cc", fontSize: 12, fontFamily: P.raj, lineHeight: 1.7 }}>
            Your on-chain identity on ArcadeX. Choose a unique username and mint your NFT — it includes ArcadeX + {chainName} branding!
          </p>
        </div>

        {/* NFT Preview */}
        <div style={{ background: "#08070f", border: `1px solid ${P.b2}`, borderRadius: 14, padding: 20, marginBottom: 20, position: "relative", overflow: "hidden" }}>
          <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 4, background: "linear-gradient(90deg,#7B2FFF,#00d4ff)", borderRadius: "14px 14px 0 0" }} />
          <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: 4, background: "linear-gradient(90deg,#7B2FFF,#00d4ff)", borderRadius: "0 0 14px 14px" }} />

          {/* Top logos */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <div style={{ width: 3, height: 20, background: "#7B2FFF", borderRadius: 2 }} />
              <span style={{ fontFamily: "Arial Black, sans-serif", fontSize: 11, fontWeight: 900, color: "#fff" }}>ARCADE</span>
              <span style={{ fontFamily: "Arial Black, sans-serif", fontSize: 11, fontWeight: 900, color: "#7B2FFF" }}>X</span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
              <span style={{ fontSize: 10, fontWeight: 700, color: "#fff", fontFamily: "Arial, sans-serif" }}>BOT</span>
              <span style={{ fontSize: 10, color: "#10A37F", fontFamily: "Arial, sans-serif" }}>Chain</span>
            </div>
          </div>

          {/* DiceBear Avatar preview */}
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10 }}>
            <div style={{ width: 90, height: 90, borderRadius: "50%", background: "rgba(123,47,255,0.12)", border: "2px solid rgba(123,47,255,0.5)", overflow: "hidden", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 0 24px rgba(123,47,255,0.35)" }}>
              {username ? (
                <img
                  src={`https://api.dicebear.com/9.x/${selectedStyle}/svg?seed=${username}`}
                  alt="avatar"
                  style={{ width: "100%", height: "100%", objectFit: "cover" }}
                />
              ) : (
                <span style={{ fontSize: 32 }}>🎮</span>
              )}
            </div>
            <div style={{ fontFamily: "Arial Black, sans-serif", fontSize: 14, fontWeight: 900, color: "#fff" }}>
              {username || "your.name"}<span style={{ color: "#7B2FFF" }}>.arcade</span>
            </div>
            <div style={{ padding: "4px 14px", background: "rgba(123,47,255,0.15)", border: "1px solid #7B2FFF", borderRadius: 12, fontSize: 9, color: "#a67fff", letterSpacing: 2 }}>✦ CREATOR</div>
          </div>
        </div>

        {/* Username input */}
        <div style={{ marginBottom: 16 }}>
          <label style={labelStyle}>Choose Username <span style={{ color: "#ff4444" }}>*</span></label>
          <div style={{ position: "relative" }}>
            <input
              value={username}
              onChange={e => setUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ""))}
              placeholder="e.g. rajdev (3-20 chars, a-z, 0-9, _)"
              style={{
                ...inputStyle,
                borderColor: usernameAvailable === true ? "rgba(0,255,136,0.4)" : usernameAvailable === false ? "rgba(255,68,68,0.4)" : P.b,
                paddingRight: 100,
              }}
            />
            <div style={{ position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)", fontSize: 10, fontFamily: P.raj, fontWeight: 700 }}>
              {usernameChecking ? <span style={{ color: "#5533aa" }}>checking...</span>
                : usernameAvailable === true ? <span style={{ color: "#00FF88" }}>✓ Available</span>
                  : usernameAvailable === false ? <span style={{ color: "#ff4444" }}>✗ Taken</span>
                    : null}
            </div>
          </div>
          <div style={{ fontSize: 10, color: "#5533aa", marginTop: 5, fontFamily: P.raj }}>Your username will be: <span style={{ color: "#a67fff" }}>{username || "yourname"}.arcade</span></div>
        </div>

        {/* Avatar Style picker */}
        <div style={{ marginBottom: 20 }}>
          <label style={labelStyle}>Avatar Style</label>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
            {DICEBEAR_STYLES.map(style => (
              <div key={style.id} onClick={() => setSelectedStyle(style.id)} style={{
                padding: "8px 6px", borderRadius: 8, cursor: "pointer", textAlign: "center",
                border: selectedStyle === style.id ? "2px solid #7B2FFF" : "1px solid rgba(123,47,255,0.2)",
                background: selectedStyle === style.id ? "rgba(123,47,255,0.15)" : "rgba(123,47,255,0.05)",
                transition: "all 0.15s",
              }}>
                {username ? (
                  <img src={`https://api.dicebear.com/9.x/${style.id}/svg?seed=${username || "preview"}`} alt={style.label} style={{ width: 36, height: 36, borderRadius: "50%", marginBottom: 4 }} />
                ) : (
                  <div style={{ width: 36, height: 36, borderRadius: "50%", background: "rgba(123,47,255,0.2)", margin: "0 auto 4px", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18 }}>{style.label.split(" ")[0]}</div>
                )}
                <div style={{ fontSize: 9, color: selectedStyle === style.id ? "#c4a0ff" : "#5533aa", fontFamily: P.raj, fontWeight: 700 }}>{style.label.split(" ").slice(1).join(" ")}</div>
                <div style={{ fontSize: 8, color: "#3a2a5a", fontFamily: P.raj }}>{style.desc}</div>
              </div>
            ))}
          </div>
        </div>

        {mintError && <div style={{ padding: 10, background: "rgba(255,68,68,0.07)", border: "1px solid rgba(255,68,68,0.2)", borderRadius: 7, color: "#ff4444", fontSize: 11, fontFamily: P.raj, marginBottom: 14 }}>{mintError}</div>}

        {/* Benefits */}
        <div style={{ background: P.s1, border: `1px solid ${P.b}`, borderRadius: 10, padding: 16, marginBottom: 16 }}>
          <div style={{ fontSize: 9, color: "#9977cc", textTransform: "uppercase", letterSpacing: "1.5px", fontFamily: P.raj, fontWeight: 700, marginBottom: 10 }}>What you get</div>
          {[["🎨", "Unique on-chain identity NFT"], ["⛓️", `ArcadeX + ${chainName} branding embedded`], ["💰", "Earn 20% revenue from your games"], ["🎮", "Publish unlimited games on ArcadeX"]].map(([icon, text]) => (
            <div key={text} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 7 }}>
              <span style={{ fontSize: 14 }}>{icon}</span>
              <span style={{ fontSize: 11, color: "#c4a0ff", fontFamily: P.raj }}>{text}</span>
            </div>
          ))}
        </div>

        <button onClick={mintNFT} disabled={mintLoading || !usernameAvailable || username.length < 3} style={{ width: "100%", padding: "14px", background: (mintLoading || !usernameAvailable || username.length < 3) ? "rgba(123,47,255,0.2)" : "linear-gradient(135deg,#7B2FFF,#5a1fd4)", border: "none", borderRadius: 8, color: (mintLoading || !usernameAvailable || username.length < 3) ? "#5533aa" : "#fff", fontSize: 13, fontWeight: 700, cursor: (mintLoading || !usernameAvailable || username.length < 3) ? "not-allowed" : "pointer", fontFamily: P.raj, letterSpacing: "1px", textTransform: "uppercase", transition: "all 0.18s" }}>
          {mintLoading ? `Minting on ${chainName}...` : "🎨 Mint Creator NFT"}
        </button>
      </div>
    </div>
  );

  // STATE 3: APPROVED — Full Dashboard
  return (
    <div style={{ minHeight: "calc(100vh - 54px)", background: P.bg, padding: isMobile ? "16px 14px" : "28px 36px" }}>
      <style>{`
        @keyframes lbPulse { 0%,100%{opacity:1} 50%{opacity:0.35} }
        .cr-input:focus { border-color: rgba(123,47,255,0.45) !important; }
        .cr-input::placeholder { color: #3a2a5a; }
        .cr-select option { background: #0e0c1a; color: #d4b8ff; }
        .cr-tab:hover { color: #c4a0ff !important; }
        .game-card-cr:hover { border-color: rgba(123,47,255,0.35) !important; transform: translateY(-2px); }
        ::-webkit-scrollbar { width: 4px; height: 4px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: rgba(123,47,255,0.3); border-radius: 2px; }
      `}</style>
      <style>{`
        @keyframes lbPulse { 0%,100%{opacity:1} 50%{opacity:0.35} }
        .cr-input:focus { border-color: rgba(123,47,255,0.45) !important; }
        .cr-input::placeholder { color: #3a2a5a; }
        .cr-select option { background: #0e0c1a; color: #d4b8ff; }
        .cr-tab:hover { color: #c4a0ff !important; }
        .game-card-cr:hover { border-color: rgba(123,47,255,0.35) !important; transform: translateY(-2px); }
      `}</style>

      <div style={{ maxWidth: 900, margin: "0 auto" }}>
        {/* Header */}
        <div style={{ marginBottom: 24 }}>
          <div style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "4px 11px", border: `1px solid ${P.pb}`, borderRadius: 4, fontSize: 9, color: "rgba(200,170,255,0.6)", letterSpacing: "1.5px", textTransform: "uppercase", marginBottom: 14, background: P.p3, fontFamily: P.raj, fontWeight: 600 }}>
            <span style={{ width: 5, height: 5, borderRadius: "50%", background: "#00FF88", animation: "lbPulse 1.5s ease-in-out infinite" }} />
            Creator Hub · ArcadeX
          </div>
          <h1 style={{ fontFamily: P.raj, fontWeight: 700, fontSize: isMobile ? 24 : 36, textTransform: "uppercase", letterSpacing: "-0.3px", color: "#fff", marginBottom: 6 }}>
            Creator <span style={{ background: "linear-gradient(90deg,#7B2FFF,#00d4ff)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>Dashboard</span>
          </h1>
          <p style={{ color: "#9977cc", fontSize: 12, fontFamily: P.raj }}>Manage your published games, track earnings, and publish new games.</p>
          <a href="/sdk" target="_blank" rel="noreferrer" style={{ display: "inline-flex", alignItems: "center", gap: 7, padding: "10px 18px", background: "rgba(0,212,255,0.07)", border: "1px solid rgba(0,212,255,0.25)", borderRadius: 8, color: "#00d4ff", fontSize: 11, fontWeight: 700, textDecoration: "none", fontFamily: P.raj, letterSpacing: "0.5px", textTransform: "uppercase", flexShrink: 0, marginTop: 4 }}>📖 SDK Docs</a>
        </div>

        {/* Profile card — NFT identity */}
        <div style={{ background: P.s1, border: `1px solid ${P.b2}`, borderRadius: 12, padding: "16px 22px", marginBottom: 22, display: "flex", alignItems: "center", gap: 16, position: "relative", overflow: "hidden" }}>
          <div style={{ position: "absolute", top: -30, right: -30, width: 150, height: 150, background: "radial-gradient(circle, rgba(123,47,255,0.12) 0%, transparent 70%)", borderRadius: "50%", pointerEvents: "none" }} />
          <div style={{ width: 46, height: 46, borderRadius: "50%", overflow: "hidden", border: "2px solid rgba(123,47,255,0.5)", flexShrink: 0, boxShadow: "0 0 16px rgba(123,47,255,0.4)", background: "#0e0c1a" }}>
            <img
              src={`https://api.dicebear.com/9.x/${nftProfile?.avatarColor || "bottts"}/svg?seed=${nftProfile?.username || address}`}
              alt="avatar"
              style={{ width: "100%", height: "100%", objectFit: "cover" }}
            />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 3 }}>
              <div style={{ fontFamily: P.raj, fontWeight: 700, fontSize: 15, color: "#c4a0ff" }}>{nftProfile?.username || address?.slice(0, 10)}.arcade</div>
              <span style={{ fontSize: 9, color: "#00FF88", background: "rgba(0,255,136,0.08)", padding: "2px 7px", borderRadius: 3, border: "1px solid rgba(0,255,136,0.15)", fontFamily: P.raj, fontWeight: 700 }}>NFT ✓</span>
            </div>
            <div style={{ fontSize: 10, color: "#7755aa", fontFamily: "monospace", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{address}</div>
          </div>
          <div style={{ display: "flex", flexShrink: 0, gap: 0 }}>
            {[{ label: "Games", value: myGames.length, color: "#a67fff" }, { label: "Balance", value: `${Number(balance).toLocaleString()} A`, color: "#00d4ff" }].map((s, i) => (
              <div key={s.label} style={{ textAlign: "center", padding: "8px 20px", borderLeft: i > 0 ? `1px solid ${P.b}` : "none" }}>
                <div style={{ fontFamily: P.raj, fontWeight: 700, fontSize: 20, color: s.color }}>{s.value}</div>
                <div style={{ fontSize: 9, color: "#9977cc", marginTop: 2, fontFamily: P.raj, textTransform: "uppercase", letterSpacing: "0.8px" }}>{s.label}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Tabs */}
        <div style={{ display: "flex", gap: 0, marginBottom: 24, borderBottom: `1px solid ${P.b}`, overflowX: isMobile ? "auto" : "visible", WebkitOverflowScrolling: "touch" }}>
          {[{ id: "my-games", label: `My Games (${myGames.length})` }, { id: "tournaments", label: `🏆 Tournaments (${myTournaments.length})` }, { id: "submit", label: "+ Submit New Game" }].map(t => (
            <button key={t.id} className="cr-tab" onClick={() => { setActiveTab(t.id); setStep(1); setError(""); }} style={{ padding: "10px 22px", background: "transparent", border: "none", borderBottom: activeTab === t.id ? "2px solid #7B2FFF" : "2px solid transparent", color: activeTab === t.id ? "#c4a0ff" : "#3a2a5a", fontSize: 12, cursor: "pointer", marginBottom: "-1px", fontFamily: P.raj, fontWeight: 700, letterSpacing: "0.5px", textTransform: "uppercase", transition: "color 0.18s" }}>
              {t.label}
            </button>
          ))}
        </div>

        {/* MY GAMES TAB */}
        {activeTab === "my-games" && (
          <div>
            {gamesLoading ? (
              <div style={{ padding: 48, textAlign: "center", fontSize: 11, color: "#9977cc", fontFamily: P.raj, textTransform: "uppercase", letterSpacing: "2px" }}>Loading from database...</div>
            ) : myGames.length === 0 ? (
              <div style={{ padding: 56, textAlign: "center" }}>
                <div style={{ width: 60, height: 60, borderRadius: "50%", background: P.p2, border: `1px solid ${P.pb}`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 26, margin: "0 auto 16px" }}>🎮</div>
                <div style={{ fontFamily: P.raj, fontWeight: 700, fontSize: 16, color: "#c4a0ff", marginBottom: 6 }}>No games yet</div>
                <div style={{ fontSize: 12, color: "#9977cc", marginBottom: 20, fontFamily: P.raj }}>Submit your first game to get started</div>
                <Btn onClick={() => setActiveTab("submit")}>Submit Your First Game →</Btn>
              </div>
            ) : (
              <div style={{ display: "grid", gridTemplateColumns: isMobile ? "repeat(2,1fr)" : "repeat(3,1fr)", gap: 10 }}>
                {myGames.map(game => {
                  const s = statusMap[game.status] || statusMap.pending;
                  return (
                    <div key={game.id} className="game-card-cr" onClick={() => navigate(`/publish/game/${game.id}`)} style={{ background: P.s1, border: `1px solid ${P.b}`, borderRadius: 10, overflow: "hidden", cursor: "pointer", transition: "all 0.2s" }}>
                      <div style={{ width: "100%", paddingTop: "56.25%", position: "relative", background: "#0a0818", overflow: "hidden" }}>
                        {(game.thumbnailUrl && game.thumbnailUrl !== "")
                          ? <img src={game.thumbnailUrl} alt={game.name} style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%", objectFit: "cover" }} onError={e => { e.target.style.display = "none"; }} />
                          : <span style={{ position: "absolute", top: "50%", left: "50%", transform: "translate(-50%,-50%)", fontSize: 32 }}>🎮</span>}
                        <span style={{ position: "absolute", top: 8, left: 8, padding: "3px 8px", borderRadius: 4, fontSize: 8, fontWeight: 700, background: s.bg, color: s.color, border: `1px solid ${s.border}`, fontFamily: P.raj }}>{s.label}</span>
                      </div>
                      <div style={{ padding: "10px 12px" }}>
                        <div style={{ fontFamily: P.raj, fontWeight: 700, fontSize: 13, color: "#d4b8ff", marginBottom: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{game.name}</div>
                        <div style={{ fontSize: 9, color: "#9977cc", marginBottom: 8, fontFamily: P.raj }}>Game #{game.gameId} · {game.category}</div>
                        <div style={{ display: "flex", justifyContent: "flex-end" }}>
  <span style={{ fontSize: 9, color: "#a67fff", fontFamily: P.orb, fontWeight: 600 }}>
    {Math.floor((game.plays || 0) * (isNativeToken ? (game.rewardRateNative || 1) : (game.rewardRate || 50)) * 0.2)} {rewardToken || "ARCADE"}
  </span>
</div></div>
                    </div>
                  );
                })}
                <div onClick={() => setActiveTab("submit")} style={{ background: "transparent", border: `1px dashed rgba(123,47,255,0.18)`, borderRadius: 10, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: 180, gap: 8, cursor: "pointer", transition: "all 0.2s" }}
                  onMouseEnter={e => { e.currentTarget.style.background = P.p3; e.currentTarget.style.borderColor = "rgba(123,47,255,0.35)"; }}
                  onMouseLeave={e => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.borderColor = "rgba(123,47,255,0.18)"; }}>
                  <div style={{ fontSize: 24, color: "rgba(123,47,255,0.3)", fontWeight: 700 }}>+</div>
                  <div style={{ fontSize: 10, color: "#9977cc", fontFamily: P.raj, textTransform: "uppercase", letterSpacing: "1px" }}>Submit New Game</div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* TOURNAMENTS TAB */}
        {activeTab === "tournaments" && (
          <div>
            {/* Header row with Create button */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
              <div>
                <div style={{ fontFamily: P.raj, fontWeight: 700, fontSize: 16, color: "#c4a0ff" }}>My Tournaments</div>
                <div style={{ fontSize: 11, color: "#5533aa", fontFamily: P.raj, marginTop: 2 }}>Create and manage tournaments for your games</div>
              </div>
              <Btn onClick={() => setShowCreateTournament(v => !v)} style={{ padding: "10px 20px" }}>
                {showCreateTournament ? "✕ Cancel" : "🏆 Create Tournament"}
              </Btn>
            </div>

            {/* Create Tournament Form */}
            {showCreateTournament && (
              <div style={{ background: P.s1, border: `1px solid ${P.b2}`, borderRadius: 12, padding: 24, marginBottom: 24 }}>
                <div style={{ fontFamily: P.raj, fontWeight: 700, fontSize: 14, color: "#c4a0ff", marginBottom: 18 }}>Tournament Details</div>

                {myGames.length === 0 ? (
                  <div style={{ padding: "24px", textAlign: "center" }}>
                    <div style={{ fontSize: 11, color: "#5533aa", fontFamily: P.raj, marginBottom: 12 }}>You need at least one approved game to create a tournament.</div>
                    <Btn onClick={() => setActiveTab("submit")} variant="ghost">Submit a Game First →</Btn>
                  </div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                    {/* Select Game */}
                    <div>
                      <label style={labelStyle}>Select Game <span style={{ color: "#ff4444" }}>*</span></label>
                      <select
                        value={tForm.gameId}
                        onChange={e => setTForm(f => ({ ...f, gameId: e.target.value }))}
                        className="cr-input cr-select"
                        style={inputStyle}
                      >
                        <option value="">-- Choose a game --</option>
                        {myGames.filter(g => g.status === "approved").map(g => (
                          <option key={g.id} value={g.id}>{g.name} (#{g.gameId})</option>
                        ))}
                      </select>
                      {myGames.filter(g => g.status === "approved").length === 0 && (
                        <div style={{ fontSize: 10, color: "#FFB800", fontFamily: P.raj, marginTop: 5 }}>⚠ No approved games yet — submit and get approved first.</div>
                      )}
                    </div>

                    <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr 1fr", gap: 12 }}>
                      <div>
                        <label style={labelStyle}>Entry Fee ({rewardToken || "ARCADE"})</label>
                        <input
                          type="number" min="0" value={tForm.entryFee}
                          onChange={e => setTForm(f => ({ ...f, entryFee: e.target.value }))}
                          className="cr-input" style={inputStyle}
                        />
                      </div>
                      <div>
                        <label style={labelStyle}>Max Players</label>
                        <input
                          type="number" min="2" max="1000" value={tForm.maxPlayers}
                          onChange={e => setTForm(f => ({ ...f, maxPlayers: e.target.value }))}
                          className="cr-input" style={inputStyle}
                        />
                      </div>
                      <div>
                        <label style={labelStyle}>Duration (Hours)</label>
                        <input
                          type="number" min="1" max="168" value={tForm.durationInHours}
                          onChange={e => setTForm(f => ({ ...f, durationInHours: e.target.value }))}
                          className="cr-input" style={inputStyle}
                        />
                      </div>
                    </div>

                    {/* Info box */}
                    <div style={{ background: "rgba(123,47,255,0.05)", border: `1px solid ${P.b}`, borderRadius: 8, padding: "12px 14px", display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                      {[
                        ["Prize Pool", `${Number(tForm.entryFee || 0) * Number(tForm.maxPlayers || 0)} ${rewardToken || "ARCADE"}`],
                        ["Starts In", "~1 min after creation"],
                        ["Max Players", tForm.maxPlayers],
                        ["Duration", `${tForm.durationInHours}h`],
                      ].map(([k, v]) => (
                        <div key={k} style={{ display: "flex", justifyContent: "space-between", fontSize: 11, padding: "5px 0", borderBottom: `1px solid ${P.b}` }}>
                          <span style={{ color: "#5533aa", fontFamily: P.raj }}>{k}</span>
                          <span style={{ color: "#c4a0ff", fontFamily: P.raj, fontWeight: 700 }}>{v}</span>
                        </div>
                      ))}
                    </div>

                    {tMsg && (
                      <div style={{ padding: 10, background: tMsg.startsWith("Error") ? "rgba(255,68,68,0.07)" : "rgba(0,255,136,0.06)", border: `1px solid ${tMsg.startsWith("Error") ? "rgba(255,68,68,0.2)" : "rgba(0,255,136,0.15)"}`, borderRadius: 7, color: tMsg.startsWith("Error") ? "#ff4444" : "#00FF88", fontSize: 11, fontFamily: P.raj }}>
                        {tMsg}
                      </div>
                    )}

                    <div style={{ display: "flex", gap: 10 }}>
                      <Btn onClick={() => { setShowCreateTournament(false); setTMsg(""); }} variant="ghost" style={{ flex: 1 }}>Cancel</Btn>
                      <Btn onClick={handleCreateTournament} disabled={tCreating || !tForm.gameId} style={{ flex: 2 }}>
                        {tCreating ? `Creating on ${chainName}...` : "🚀 Create Tournament"}
                      </Btn>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Tournament list */}
            {tournamentsLoading ? (
              <div style={{ padding: 48, textAlign: "center", fontSize: 11, color: "#9977cc", fontFamily: P.raj, textTransform: "uppercase", letterSpacing: "2px" }}>Loading tournaments...</div>
            ) : myTournaments.length === 0 ? (
              <div style={{ padding: 56, textAlign: "center" }}>
                <div style={{ width: 60, height: 60, borderRadius: "50%", background: P.p2, border: `1px solid ${P.pb}`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 26, margin: "0 auto 16px" }}>🏆</div>
                <div style={{ fontFamily: P.raj, fontWeight: 700, fontSize: 16, color: "#c4a0ff", marginBottom: 6 }}>No tournaments yet</div>
                <div style={{ fontSize: 12, color: "#9977cc", marginBottom: 20, fontFamily: P.raj }}>Create your first tournament to get started</div>
                <Btn onClick={() => setShowCreateTournament(true)}>Create First Tournament →</Btn>
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {myTournaments.map(t => {
                  const now = Date.now() / 1000;
                  const realStatus = t.status === 2 ? "Ended"
                    : t.status === 3 ? "Cancelled"
                    : now >= t.startTime && now <= t.endTime ? "Active"
                    : now > t.endTime ? "Ended"
                    : "Upcoming";

                  const statusLabel = realStatus === "Upcoming" ? { label: "⏳ Upcoming", color: "#FFB800", bg: "rgba(255,184,0,0.08)", border: "rgba(255,184,0,0.2)" }
                    : realStatus === "Active" ? { label: "🟢 Active", color: "#00FF88", bg: "rgba(0,255,136,0.08)", border: "rgba(0,255,136,0.2)" }
                    : realStatus === "Cancelled" ? { label: "✗ Cancelled", color: "#ff4444", bg: "rgba(255,68,68,0.08)", border: "rgba(255,68,68,0.2)" }
                    : { label: "✓ Ended", color: "#7755aa", bg: "rgba(123,47,255,0.08)", border: "rgba(123,47,255,0.2)" };
                  const prizePool = Number(t.prizePool) / 1e18;
                  const endTime = new Date(Number(t.endTime) * 1000);
                  return (
                    <div key={t.id} style={{ background: P.s1, border: `1px solid ${P.b}`, borderRadius: 10, padding: "14px 18px", display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
                      {t.gameThumbnail && (
                        <img src={t.gameThumbnail} alt="" style={{ width: 50, height: 50, borderRadius: 6, objectFit: "cover", flexShrink: 0 }} />
                      )}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4, flexWrap: "wrap" }}>
                          <span style={{ fontFamily: P.raj, fontWeight: 700, fontSize: 14, color: "#d4b8ff" }}>{t.gameName}</span>
                          <span style={{ fontSize: 9, padding: "2px 7px", borderRadius: 3, fontWeight: 700, background: statusLabel.bg, color: statusLabel.color, border: `1px solid ${statusLabel.border}`, fontFamily: P.raj }}>{statusLabel.label}</span>
                        </div>
                        <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
                          {[
                            ["Players", `${t.players?.length || 0} / ${Number(t.maxPlayers)}`],
                            ["Entry Fee", `${Number(t.entryFee) / 1e18} ${rewardToken || "ARCADE"}`],
                            ["Prize Pool", `${prizePool.toFixed(0)} ${rewardToken || "ARCADE"}`],
                            ["Ends", endTime.toLocaleDateString()],
                          ].map(([k, v]) => (
                            <div key={k} style={{ fontSize: 10, color: "#9977cc", fontFamily: P.raj }}>
                              <span style={{ color: "#5533aa" }}>{k}: </span>
                              <span style={{ color: "#c4a0ff", fontWeight: 700 }}>{v}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                      {(realStatus === "Active" || realStatus === "Ended") && !t.prizesDistributed && (
                        <Btn onClick={() => handleEndTournament(t.id)} variant="ghost" style={{ fontSize: 11, padding: "7px 14px", flexShrink: 0 }}>
                          End & Distribute 🏆
                        </Btn>
                      )}
                      {t.prizesDistributed && (
                        <div style={{ fontSize: 10, color: "#00FF88", fontFamily: P.raj, fontWeight: 700, padding: "7px 14px", flexShrink: 0 }}>✓ Prizes Sent</div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {tMsg && !showCreateTournament && (
              <div style={{ marginTop: 14, padding: 10, background: tMsg.startsWith("Error") ? "rgba(255,68,68,0.07)" : "rgba(0,255,136,0.06)", border: `1px solid ${tMsg.startsWith("Error") ? "rgba(255,68,68,0.2)" : "rgba(0,255,136,0.15)"}`, borderRadius: 7, color: tMsg.startsWith("Error") ? "#ff4444" : "#00FF88", fontSize: 11, fontFamily: P.raj }}>
                {tMsg}
              </div>
            )}
          </div>
        )}

        {/* SUBMIT TAB */}
        {activeTab === "submit" && (
          <div>
            <div style={{ display: "flex", gap: 8, marginBottom: 24 }}>
              {[{ n: 1, label: isMobile ? "Details" : "Game Details" }, { n: 2, label: isMobile ? "Review" : "Review & Submit" }, { n: 3, label: "Published!" }].map(s => (
                <div key={s.n} style={{ flex: 1, padding: "10px 14px", borderRadius: 8, border: `1px solid ${step === s.n ? "rgba(123,47,255,0.4)" : step > s.n ? "rgba(0,255,136,0.15)" : P.b}`, background: step === s.n ? P.p3 : "transparent", display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ width: 20, height: 20, borderRadius: "50%", background: step >= s.n ? (step > s.n ? "rgba(0,255,136,0.2)" : "#7B2FFF") : "rgba(123,47,255,0.1)", border: `1px solid ${step >= s.n ? (step > s.n ? "rgba(0,255,136,0.3)" : "#7B2FFF") : P.b}`, color: step >= s.n ? (step > s.n ? "#00FF88" : "#fff") : "#5533aa", fontSize: 9, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, fontFamily: P.raj }}>
                    {step > s.n ? "✓" : s.n}
                  </span>
                  <span style={{ fontSize: 11, color: step === s.n ? "#c4a0ff" : "#5533aa", fontFamily: P.raj, fontWeight: 700 }}>{s.label}</span>
                </div>
              ))}
            </div>

            {step === 1 && (
              <div style={{ display: "flex", flexDirection: "column", gap: 16, maxWidth: 600 }}>
                {[{ name: "name", label: "Game Name", required: true, placeholder: "e.g. Pixel Runner" }, { name: "description", label: "Description", required: true, placeholder: "Describe your game...", textarea: true }].map(f => (
                  <div key={f.name}>
                    <label style={labelStyle}>{f.label} {f.required && <span style={{ color: "#ff4444" }}>*</span>}</label>
                    {f.textarea
                      ? <textarea name={f.name} value={form[f.name]} onChange={handleChange} placeholder={f.placeholder} rows={3} className="cr-input" style={{ ...inputStyle, resize: "vertical" }} />
                      : <input name={f.name} value={form[f.name]} onChange={handleChange} placeholder={f.placeholder} className="cr-input" style={inputStyle} />}
                  </div>
                ))}
                <div>
                  <label style={labelStyle}>Game URL <span style={{ color: "#ff4444" }}>*</span></label>
                  <input name="iframeUrl" value={form.iframeUrl} onChange={handleChange} placeholder="https://username.github.io/my-game" className="cr-input" style={{ ...inputStyle, borderColor: form.iframeUrl ? (validateUrl(form.iframeUrl) ? "rgba(0,255,136,0.25)" : "rgba(255,68,68,0.25)") : P.b }} />
                </div>
                <div>
                  <label style={labelStyle}>Game Thumbnail <span style={{ color: "#ff4444" }}>*</span></label>
                  <div
                    onClick={() => !uploading && document.getElementById("thumb-upload").click()}
                    onDragOver={e => { e.preventDefault(); e.currentTarget.style.borderColor = "rgba(123,47,255,0.5)"; }}
                    onDragLeave={e => { e.currentTarget.style.borderColor = P.b; }}
                    onDrop={async e => {
                      e.preventDefault();
                      e.currentTarget.style.borderColor = P.b;
                      const file = e.dataTransfer.files[0];
                      if (file && file.type.startsWith("image/")) {
                        const url = await uploadToCloudinary(file);
                        if (url) setForm(f => ({ ...f, thumbnailUrl: url }));
                      }
                    }}
                    style={{ width: "100%", minHeight: 100, border: `2px dashed ${form.thumbnailUrl ? "rgba(0,255,136,0.3)" : P.b}`, borderRadius: 8, background: "rgba(123,47,255,0.04)", cursor: uploading ? "not-allowed" : "pointer", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 8, transition: "all 0.2s", position: "relative", overflow: "hidden", boxSizing: "border-box" }}
                  >
                    {form.thumbnailUrl ? (
                      <>
                        <img src={form.thumbnailUrl} alt="thumbnail" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", opacity: 0.7 }} />
                        <div style={{ position: "relative", zIndex: 1, background: "rgba(0,0,0,0.6)", padding: "4px 12px", borderRadius: 20, display: "flex", alignItems: "center", gap: 6 }}>
                          <span style={{ fontSize: 10, color: "#00FF88", fontFamily: P.raj, fontWeight: 700 }}>✓ Uploaded!</span>
                          <span onClick={e => { e.stopPropagation(); setForm(f => ({ ...f, thumbnailUrl: "" })); }} style={{ fontSize: 10, color: "#ff4444", cursor: "pointer", fontFamily: P.raj, fontWeight: 700 }}>✕ Remove</span>
                        </div>
                      </>
                    ) : uploading ? (
                      <>
                        <div style={{ fontSize: 12, color: "#a67fff", fontFamily: P.raj, fontWeight: 700 }}>Uploading... {uploadProgress}%</div>
                        <div style={{ width: "60%", height: 4, background: "rgba(123,47,255,0.1)", borderRadius: 2, overflow: "hidden" }}>
                          <div style={{ height: "100%", width: `${uploadProgress}%`, background: "linear-gradient(90deg,#7B2FFF,#00d4ff)", borderRadius: 2, transition: "width 0.3s" }} />
                        </div>
                      </>
                    ) : (
                      <>
                        <div style={{ fontSize: 24 }}>🖼️</div>
                        <div style={{ fontSize: 12, color: "#a67fff", fontFamily: P.raj, fontWeight: 700 }}>Click or drag & drop image</div>
                        <div style={{ fontSize: 10, color: "#5533aa", fontFamily: P.raj }}>PNG, JPG, WebP — max 5MB</div>
                      </>
                    )}
                  </div>
                  <input
                    id="thumb-upload"
                    type="file"
                    accept="image/*"
                    style={{ display: "none" }}
                    onChange={async e => {
                      const file = e.target.files[0];
                      if (file) {
                        const url = await uploadToCloudinary(file);
                        if (url) setForm(f => ({ ...f, thumbnailUrl: url }));
                      }
                    }}
                  />
                </div>
                <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 12 }}>
                  <div>
                    <label style={labelStyle}>Category</label>
                    <select name="category" value={form.category} onChange={handleChange} className="cr-input cr-select" style={inputStyle}>
                      {categories.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </div>
                  <div>
                    <label style={labelStyle}>Reward Rate (ARCADE — BOTChain/Somnia)</label>
                    <input name="rewardRate" value={form.rewardRate} onChange={handleChange} type="number" min={ARCADE_MIN} max={ARCADE_MAX} className="cr-input" style={inputStyle} />
                  </div>
                  <div>
                    <label style={labelStyle}>Reward Rate (Native — MST, real value token)</label>
                    <input name="rewardRateNative" value={form.rewardRateNative} onChange={handleChange} type="number" min={NATIVE_MIN} max={NATIVE_MAX} className="cr-input" style={inputStyle} />
                  </div>
                </div>
                <div style={{ fontSize: 10.5, color: "#7755aa", fontFamily: P.raj, marginTop: -6 }}>
                  Native-chain rate is capped {NATIVE_MIN}–{NATIVE_MAX} since MSTC carries real value — this only applies when your game is played on a native-token chain like MST.
                </div>
                {error && <div style={{ padding: 10, background: "rgba(255,68,68,0.07)", border: "1px solid rgba(255,68,68,0.2)", borderRadius: 7, color: "#ff4444", fontSize: 11, fontFamily: P.raj }}>{error}</div>}
                <Btn onClick={() => {
                  if (!form.name || !form.iframeUrl || !form.description) { setError("Please fill in all required fields."); return; }
                  if (!validateUrl(form.iframeUrl)) { setError("Please enter a valid game URL."); return; }
                  if (!form.thumbnailUrl) { setError("Please upload a thumbnail image."); return; }
                  setError(""); setStep(2);
                }} style={{ alignSelf: "flex-start", padding: "12px 28px" }}>
                  Continue to Review →
                </Btn>
              </div>
            )}

            {step === 2 && (
              <div style={{ display: "flex", flexDirection: "column", gap: 14, maxWidth: 600 }}>
                <div style={{ background: P.s1, border: `1px solid ${P.b}`, borderRadius: 10, padding: 20 }}>
                  <div style={{ fontFamily: P.raj, fontWeight: 700, fontSize: 14, color: "#c4a0ff", marginBottom: 16 }}>Review your submission</div>
                  {[["Game Name", form.name], ["Description", form.description], ["Game URL", form.iframeUrl], ["Category", form.category], ["Reward Rate (ARCADE)", `${form.rewardRate} ARCADE per play`], ["Reward Rate (Native)", `${form.rewardRateNative} MSTC per play`], ["Creator", `${nftProfile?.username || address?.slice(0, 8)}.arcade`]].map(([k, v]) => (
                    <div key={k} style={{ display: "flex", justifyContent: "space-between", fontSize: 12, padding: "8px 0", borderBottom: `1px solid ${P.b}` }}>
                      <span style={{ color: "#9977cc", minWidth: 130, fontFamily: P.raj }}>{k}</span>
                      <span style={{ color: "#c4a0ff", textAlign: "right", wordBreak: "break-all", fontFamily: P.raj, fontWeight: 600 }}>{v}</span>
                    </div>
                  ))}
                </div>
                {error && <div style={{ padding: 10, background: "rgba(255,68,68,0.07)", border: "1px solid rgba(255,68,68,0.2)", borderRadius: 7, color: "#ff4444", fontSize: 11, fontFamily: P.raj }}>{error}</div>}
                <div style={{ display: "flex", gap: 10 }}>
                  <Btn onClick={() => setStep(1)} variant="ghost" style={{ flex: 1 }}>← Back</Btn>
                  <Btn onClick={submitGame} disabled={loading} style={{ flex: 2 }}>
                    {loading ? `Submitting to ${chainName}...` : "Submit Game 🚀"}
                  </Btn>
                </div>
              </div>
            )}

            {step === 3 && (
              <div style={{ textAlign: "center", padding: "40px 0", maxWidth: 500, margin: "0 auto" }}>
                <div style={{ width: 72, height: 72, borderRadius: "50%", background: "rgba(0,255,136,0.1)", border: "1px solid rgba(0,255,136,0.25)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 30, margin: "0 auto 20px" }}>🎉</div>
                <h2 style={{ fontFamily: P.raj, fontWeight: 700, fontSize: 28, textTransform: "uppercase", marginBottom: 10, color: "#fff" }}>
                  Game <span style={{ background: "linear-gradient(90deg,#7B2FFF,#00d4ff)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>Submitted!</span>
                </h2>
                <p style={{ color: "#9977cc", fontSize: 12, maxWidth: 380, margin: "0 auto 24px", lineHeight: 1.75, fontFamily: P.raj }}>
                  Your game is now in the review queue. Once approved, it will go live on ArcadeX.
                </p>
                {newGameId && (
                  <div style={{ background: P.s1, border: `1px solid ${P.b2}`, borderRadius: 10, padding: 18, marginBottom: 12 }}>
                    <div style={{ fontSize: 9, color: "#9977cc", textTransform: "uppercase", letterSpacing: "1.5px", fontFamily: P.raj, fontWeight: 700, marginBottom: 6 }}>Your Game ID</div>
                    <div style={{ fontFamily: P.orb, fontWeight: 700, fontSize: 32, color: "#a67fff", marginBottom: 10, letterSpacing: "-1px" }}>#{newGameId}</div>
                    <div style={{ fontFamily: "monospace", fontSize: 11, color: "#9977cc", background: P.bg, padding: "8px 12px", borderRadius: 6, border: `1px solid ${P.b}` }}>
                      Application.ExternalCall("arcade_init", "{newGameId}");
                    </div>
                  </div>
                )}
                {txHash && (
                  <div style={{ background: "rgba(0,255,136,0.06)", border: "1px solid rgba(0,255,136,0.15)", borderRadius: 8, padding: 14, marginBottom: 20 }}>
                    <div style={{ fontSize: 9, color: "#00FF88", marginBottom: 5, textTransform: "uppercase", letterSpacing: "1px", fontFamily: P.raj, fontWeight: 700 }}>Transaction confirmed ✓</div>
                    <div style={{ fontSize: 9, color: "#9977cc", wordBreak: "break-all", fontFamily: "monospace" }}>{txHash}</div>
                  </div>
                )}
                <div style={{ display: "flex", gap: 10, justifyContent: "center" }}>
                  <Btn onClick={() => { setActiveTab("my-games"); setStep(1); setForm({ name: "", description: "", iframeUrl: "", thumbnailUrl: "", category: "Action", rewardRate: "50", rewardRateNative: "1" }); setTxHash(""); setNewGameId(null); }}>View My Games →</Btn>
                  <Btn onClick={() => { setStep(1); setForm({ name: "", description: "", iframeUrl: "", thumbnailUrl: "", category: "Action", rewardRate: "50", rewardRateNative: "1" }); setTxHash(""); setNewGameId(null); }} variant="ghost">Submit Another</Btn>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {selectedGame && <GameModal game={selectedGame} onClose={() => setSelectedGame(null)} />}
    </div>
  );
}