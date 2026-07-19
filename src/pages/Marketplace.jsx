import { useState, useEffect } from "react";
import { useAccount, usePublicClient, useBalance } from "wagmi";
// sendTransaction import kiya hai native transfer ke liye
import { writeContract, waitForTransactionReceipt, sendTransaction } from "@wagmi/core";
import { wagmiAdapter } from "../Providers";
import { useChain } from "../context/ChainContext";
import { getUnlockedStyles, unlockAvatarStyle, getActiveAvatarStyle, setActiveAvatarStyle } from "../utils/avatarUtils";
import { useArcadeBalance } from "../hooks/useArcadeBalance";

// All available DiceBear styles with pricing tiers
const AVATAR_STYLES = [
  { id: "bottts",      label: "Bottts",      tier: "Free",      price: 0,   emoji: "🤖", desc: "Web3 robot vibes" },
  { id: "pixel-art",   label: "Pixel Art",   tier: "Free",      price: 0,   emoji: "👾", desc: "Classic arcade look" },
  { id: "adventurer",  label: "Adventurer",  tier: "Uncommon",  price: 100, emoji: "🧙", desc: "Gamer cartoon style" },
  { id: "lorelei",     label: "Lorelei",     tier: "Uncommon",  price: 100, emoji: "🧝", desc: "Anime-inspired" },
  { id: "notionists",  label: "Notionists",  tier: "Rare",      price: 300, emoji: "✏️", desc: "Minimal line art" },
  { id: "micah",       label: "Micah",       tier: "Rare",      price: 300, emoji: "🎨", desc: "Modern illustration" },
  { id: "rings",       label: "Rings",       tier: "Epic",      price: 500, emoji: "💫", desc: "Abstract geometric" },
  { id: "shapes",      label: "Shapes",      tier: "Epic",      price: 500, emoji: "🔷", desc: "Bold abstract art" },
  { id: "thumbs",      label: "Thumbs",      tier: "Legendary", price: 800, emoji: "👍", desc: "Ultra rare character" },
  { id: "croodles",    label: "Croodles",    tier: "Legendary", price: 800, emoji: "✨", desc: "Hand-drawn exclusive" },
];

const TIER_COLOR = {
  Free:      "#5533aa",
  Uncommon:  "#00FF88",
  Rare:      "#00d4ff",
  Epic:      "#a67fff",
  Legendary: "#FFB700",
};

// MARKETPLACE_ADDRESS, ARCADE_TOKEN_ADDRESS now come from useChain()

const MARKETPLACE_ABI = [
  { name: "buyArcadeWithBot", type: "function", stateMutability: "payable", inputs: [], outputs: [] },
  // buyItemWithArcade ko payable kar diya taaki MST chain par native value pass ho sake
  { name: "buyItemWithArcade", type: "function", stateMutability: "payable", inputs: [{ name: "itemId", type: "uint256" }], outputs: [] },
  { name: "buyItemWithBot", type: "function", stateMutability: "payable", inputs: [{ name: "itemId", type: "uint256" }], outputs: [] },
  { name: "getArcadeForBot", type: "function", stateMutability: "view", inputs: [{ name: "botAmount", type: "uint256" }], outputs: [{ name: "", type: "uint256" }] },
  { name: "getAllItems", type: "function", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "tuple[]", components: [{ name: "id", type: "uint256" }, { name: "name", type: "string" }, { name: "description", type: "string" }, { name: "imageURI", type: "string" }, { name: "itemType", type: "uint8" }, { name: "arcadePrice", type: "uint256" }, { name: "botPrice", type: "uint256" }, { name: "totalSupply", type: "uint256" }, { name: "sold", type: "uint256" }, { name: "active", type: "bool" }] }] },
  { name: "getUserItems", type: "function", stateMutability: "view", inputs: [{ name: "user", type: "address" }], outputs: [{ name: "", type: "uint256[]" }] },
  { name: "ownsItem", type: "function", stateMutability: "view", inputs: [{ name: "user", type: "address" }, { name: "itemId", type: "uint256" }], outputs: [{ name: "", type: "bool" }] },
  { name: "arcadePerBot", type: "function", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint256" }] },
];

const ERC20_ABI = [
  { name: "approve",   type: "function", stateMutability: "nonpayable", inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }], outputs: [{ name: "", type: "bool" }] },
  { name: "balanceOf", type: "function", stateMutability: "view",       inputs: [{ name: "account", type: "address" }], outputs: [{ name: "", type: "uint256" }] },
  { name: "allowance", type: "function", stateMutability: "view",       inputs: [{ name: "owner", type: "address" }, { name: "spender", type: "address" }], outputs: [{ name: "", type: "uint256" }] },
  { name: "transfer",  type: "function", stateMutability: "nonpayable", inputs: [{ name: "to", type: "address" }, { name: "amount", type: "uint256" }], outputs: [{ name: "", type: "bool" }] },
];

const ITEM_TYPE = ["Badge", "Frame", "Power-Up", "Skin"];
const ITEM_EMOJI = ["🏅", "🖼️", "⚡", "🎨"];
const ITEM_COLOR = ["#FFB700", "#00d4ff", "#00FF88", "#a67fff"];

// ── Campaign Badges ──────────────────────────────────────────────────────────


const CAMPAIGN_BADGE_ABI = [
  { name: "claimBadge", type: "function", stateMutability: "nonpayable", inputs: [{ name: "badgeTypeId", type: "uint256" }, { name: "signature", type: "bytes" }], outputs: [] },
  { name: "getBadgeType", type: "function", stateMutability: "view", inputs: [{ name: "badgeTypeId", type: "uint256" }], outputs: [{ name: "", type: "tuple", components: [{ name: "name", type: "string" }, { name: "maxSupply", type: "uint256" }, { name: "minted", type: "uint256" }, { name: "imageURI", type: "string" }, { name: "active", type: "bool" }] }] },
  { name: "hasClaimed", type: "function", stateMutability: "view", inputs: [{ name: "", type: "address" }, { name: "", type: "uint256" }], outputs: [{ name: "", type: "bool" }] },
];

const BADGE_TYPE_IDS = { genesis: 1, pioneer: 2, legend: 3, creator: 4, builder: 5 };

const BADGE_META = {
  1: { key: "genesis", name: "Genesis Badge", tier: "#CD7F32", criteria: "Play 5 different games on ArcadeX" },
  2: { key: "pioneer", name: "Pioneer Badge", tier: "#C0C0C0", criteria: "Finish in Top 500 players by ARCADE earned" },
  3: { key: "legend",  name: "Legend Badge",  tier: "#FFD700", criteria: "Finish in Top 50 players by ARCADE earned" },
  4: { key: "creator", name: "Creator Badge", tier: "#7B2FFF", criteria: "Publish a game on ArcadeX during the campaign" },
  5: { key: "builder", name: "Builder Badge", tier: "#00d4ff", criteria: "Top 10 creators by total plays during campaign" },
};

async function getGasWithBuffer(publicClient, { address, abi, functionName, args, account, value, bufferPct = 30 }) {
  try {
    const estimated = await publicClient.estimateContractGas({
      address, abi, functionName, args, account, value
    });
    return (estimated * BigInt(100 + bufferPct)) / 100n;
  } catch (err) {
    console.warn(`Gas estimation failed for ${functionName}, using fallback:`, err.shortMessage || err.message);
    return BigInt(3000000);
  }
}

const P = {
  bg: "#08070f", s1: "#0e0c1a",
  b: "rgba(123,47,255,0.12)", b2: "rgba(123,47,255,0.25)",
  raj: "'Rajdhani',sans-serif", orb: "'Orbitron',sans-serif",
};

function ItemCard({ item, owned, onBuyArcade, onBuyBot, buying, buyingId, arcadeBalance, botBalance, tokenName }) {
  const [hovered, setHovered] = useState(false);
  const isBuying = buying && buyingId === Number(item.id);
  const arcadePrice = Number(item.arcadePrice) / 1e18;
  const botPrice = Number(item.botPrice) / 1e18;
  const sold = Number(item.sold);
  const total = Number(item.totalSupply);
  const fillPct = total > 0 ? (sold / total) * 100 : 0;
  const soldOut = total > 0 && sold >= total;
  const typeIdx = Number(item.itemType);
  const color = ITEM_COLOR[typeIdx] || "#a67fff";
  const insufficientArcade = arcadePrice > 0 && arcadeBalance < arcadePrice;
  const insufficientBot = botPrice > 0 && Number(botBalance?.formatted || 0) < botPrice;

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        background: hovered ? "rgba(14,12,26,0.98)" : "rgba(10,8,20,0.9)",
        border: `1px solid ${hovered ? color + "55" : "rgba(123,47,255,0.15)"}`,
        borderRadius: 16, overflow: "hidden",
        transition: "all 0.3s cubic-bezier(0.4,0,0.2,1)",
        transform: hovered ? "translateY(-4px)" : "translateY(0)",
        boxShadow: hovered ? `0 20px 40px rgba(0,0,0,0.5), 0 0 30px ${color}18` : "0 4px 12px rgba(0,0,0,0.3)",
        position: "relative",
      }}
    >
      <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 2, background: `linear-gradient(90deg, transparent, ${color}, transparent)`, opacity: hovered ? 1 : 0.3, transition: "opacity 0.3s" }} />

      <div style={{ height: 140, background: `linear-gradient(135deg, rgba(${typeIdx === 0 ? "255,183,0" : typeIdx === 1 ? "0,212,255" : typeIdx === 2 ? "0,255,136" : "123,47,255"},0.1) 0%, rgba(0,0,0,0) 100%)`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 56, position: "relative" }}>
        {ITEM_EMOJI[typeIdx] || "🎮"}
        {owned && <div style={{ position: "absolute", top: 10, right: 10, padding: "4px 10px", borderRadius: 20, background: "rgba(0,255,136,0.15)", border: "1px solid rgba(0,255,136,0.3)", color: "#00FF88", fontSize: 10, fontFamily: P.raj, fontWeight: 700, letterSpacing: "1px" }}>✓ OWNED</div>}
        {soldOut && !owned && <div style={{ position: "absolute", top: 10, right: 10, padding: "4px 10px", borderRadius: 20, background: "rgba(255,68,68,0.15)", border: "1px solid rgba(255,68,68,0.3)", color: "#ff4444", fontSize: 10, fontFamily: P.raj, fontWeight: 700 }}>SOLD OUT</div>}
        <div style={{ position: "absolute", top: 10, left: 10, padding: "3px 9px", borderRadius: 20, background: `${color}22`, border: `1px solid ${color}44`, color, fontSize: 9, fontFamily: P.raj, fontWeight: 700, letterSpacing: "1.5px" }}>
          {ITEM_TYPE[typeIdx]}
        </div>
      </div>

      <div style={{ padding: "14px 16px" }}>
        <div style={{ fontFamily: P.raj, fontWeight: 700, fontSize: 16, color: "#fff", marginBottom: 4 }}>{item.name}</div>
        <div style={{ fontSize: 11, color: "#5533aa", fontFamily: P.raj, marginBottom: 12, lineHeight: 1.5 }}>{item.description}</div>

        {total > 0 && (
          <div style={{ marginBottom: 12 }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
              <div style={{ fontSize: 9, color: "#5533aa", fontFamily: P.raj, fontWeight: 700, textTransform: "uppercase", letterSpacing: "1px" }}>Supply</div>
              <div style={{ fontSize: 10, color: "#a67fff", fontFamily: P.orb }}>{sold}/{total}</div>
            </div>
            <div style={{ height: 3, background: "rgba(123,47,255,0.1)", borderRadius: 2 }}>
              <div style={{ height: "100%", width: `${fillPct}%`, background: fillPct >= 80 ? "linear-gradient(90deg,#ff4444,#ff7700)" : `linear-gradient(90deg,${color},${color}88)`, borderRadius: 2, transition: "width 1s ease" }} />
            </div>
          </div>
        )}

        {!owned && !soldOut && (
          <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
            {arcadePrice > 0 && (
              <button onClick={() => onBuyArcade(item)} disabled={isBuying || insufficientArcade} style={{
                width: "100%", padding: "10px",
                background: insufficientArcade ? "rgba(255,68,68,0.08)" : isBuying ? "rgba(123,47,255,0.2)" : "linear-gradient(135deg,#7B2FFF,#5a1fd4)",
                border: insufficientArcade ? "1px solid rgba(255,68,68,0.25)" : "none",
                borderRadius: 8,
                color: insufficientArcade ? "#ff4444" : isBuying ? "#5533aa" : "#fff",
                fontSize: 12, fontWeight: 700, cursor: (isBuying || insufficientArcade) ? "not-allowed" : "pointer",
                fontFamily: P.raj, letterSpacing: "1px", textTransform: "uppercase",
                transition: "all 0.2s", display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
              }}>
                <span>🎮</span>
                {insufficientArcade ? `Need ${arcadePrice.toLocaleString()} ${tokenName}` : isBuying ? "Buying..." : `${arcadePrice.toLocaleString()} ${tokenName}`}
              </button>
            )}
            {botPrice > 0 && (
              <button onClick={() => onBuyBot(item)} disabled={isBuying || insufficientBot} style={{
                width: "100%", padding: "10px",
                background: insufficientBot ? "rgba(255,68,68,0.08)" : isBuying ? "rgba(0,212,255,0.1)" : "linear-gradient(135deg,rgba(0,212,255,0.2),rgba(0,212,255,0.1))",
                border: `1px solid ${insufficientBot ? "rgba(255,68,68,0.25)" : "rgba(0,212,255,0.3)"}`,
                borderRadius: 8,
                color: insufficientBot ? "#ff4444" : isBuying ? "#5533aa" : "#00d4ff",
                fontSize: 12, fontWeight: 700, cursor: (isBuying || insufficientBot) ? "not-allowed" : "pointer",
                fontFamily: P.raj, letterSpacing: "1px", textTransform: "uppercase",
                transition: "all 0.2s", display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
              }}>
                <span>⛓️</span>
                {insufficientBot ? `Need ${botPrice} BOT` : isBuying ? "Buying..." : `${botPrice} BOT`}
              </button>
            )}
          </div>
        )}

        {owned && (
          <div style={{ padding: "10px", background: "rgba(0,255,136,0.05)", border: "1px solid rgba(0,255,136,0.15)", borderRadius: 8, textAlign: "center", fontSize: 12, color: "#00FF88", fontFamily: P.raj, fontWeight: 700 }}>
            ✓ In Your Collection
          </div>
        )}
      </div>
    </div>
  );
}

export default function Marketplace() {
  const { address, isConnected } = useAccount();
  const publicClient = usePublicClient();
  const { data: botBalance } = useBalance({ address });
  
  // rewardType & rewardToken fetch kiya for dynamic native behaviour
  const { contracts, chainId: CHAIN_ID, nativeCurrency, rewardType, rewardToken } = useChain();



const NATIVE_SYMBOL = nativeCurrency?.symbol || "native token";
const MARKETPLACE_ADDRESS = contracts?.marketplace;
const ARCADE_TOKEN_ADDRESS = contracts?.token;
const tokenName = rewardToken || "ARCADE";
const CAMPAIGN_BADGE_ADDRESS = contracts?.campaignBadge || null;  // ← YE ADD KARO
  


  const [items, setItems] = useState([]);
  const [userItems, setUserItems] = useState([]);const { balance } = useArcadeBalance();
const arcadeBalance = Number(balance);
  const [arcadePerBot, setArcadePerBot] = useState(1000);
  const [loading, setLoading] = useState(true);
  const [buying, setBuying] = useState(false);
  const [buyingId, setBuyingId] = useState(null);
  const [msg, setMsg] = useState("");
  const [activeTab, setActiveTab] = useState("avatar");
  const [activeFilter, setActiveFilter] = useState("all");
  const [isMobile, setIsMobile] = useState(window.innerWidth <= 768);
  const [unlockedStyles, setUnlockedStyles] = useState([]);
  const [activeStyle, setActiveStyle] = useState("bottts");

  const [botAmount, setBotAmount] = useState("0.1");
  const [swapping, setSwapping] = useState(false);

  const [badges, setBadges] = useState([]);
  const [badgesLoading, setBadgesLoading] = useState(true);
  const [claiming, setClaiming] = useState(false);
  const [claimingId, setClaimingId] = useState(null);

 const fetchData = async () => {
    // Safety check: Agar publicClient ya MARKETPLACE_ADDRESS nahi hai toh API call mat karo
    if (!publicClient || !MARKETPLACE_ADDRESS) return; 
    
    setLoading(true);
    try {
      const [allItems, rate] = await Promise.all([
        publicClient.readContract({ address: MARKETPLACE_ADDRESS, abi: MARKETPLACE_ABI, functionName: "getAllItems" }),
        publicClient.readContract({ address: MARKETPLACE_ADDRESS, abi: MARKETPLACE_ABI, functionName: "arcadePerBot" }),
      ]);
      setItems(allItems.filter(i => i.active));
      setArcadePerBot(Number(rate) / 1e18);

      if (address) {
        const owned = await publicClient.readContract({ address: MARKETPLACE_ADDRESS, abi: MARKETPLACE_ABI, functionName: "getUserItems", args: [address] });
        setUserItems(owned.map(id => Number(id)));

        // ⚠️ MANUAL BALANCE FETCHING REMOVED ⚠️
        // Ab balance yahan se calculate nahi hoga, 'useArcadeBalance' hook usko directly sambhal raha hai.
      }
    } catch (err) { 
      console.error("Marketplace fetch error:", err); 
    }
    finally { 
      setLoading(false); 
    }
  };



  useEffect(() => { fetchData(); }, [publicClient, address]);

  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth <= 768);
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  useEffect(() => {
    if (address) {
      setUnlockedStyles(getUnlockedStyles(address));
      setActiveStyle(getActiveAvatarStyle(address));
    }
  }, [address]);

  const handleUnlockStyle = async (style) => {
    if (!address) return;
    if (style.price === 0) {
      unlockAvatarStyle(address, style.id);
      setUnlockedStyles(getUnlockedStyles(address));
      setMsg(`✅ ${style.label} style unlocked!`);
      return;
    }
    const priceWei = BigInt(style.price) * BigInt(1e18);
    if (arcadeBalance < style.price) {
      setMsg(`❌ Need ${style.price} ${tokenName}. You have ${arcadeBalance.toLocaleString()}.`);
      return;
    }
    setBuying(true);
    setMsg(`⏳ Spending ${tokenName} to unlock style...`);
    try {
      // Direct Native Transaction if on MST, else ERC20
      if (rewardType === "native") {
          const hash = await sendTransaction(wagmiAdapter.wagmiConfig, {
            to: MARKETPLACE_ADDRESS,
            value: priceWei,
            chainId: CHAIN_ID,
          });
          await waitForTransactionReceipt(wagmiAdapter.wagmiConfig, { hash });
      } else {
          const allowance = await publicClient.readContract({
            address: ARCADE_TOKEN_ADDRESS, abi: ERC20_ABI,
            functionName: "allowance", args: [address, MARKETPLACE_ADDRESS],
          });
          if (BigInt(allowance) < priceWei) {
            const approveArgs = [MARKETPLACE_ADDRESS, priceWei];
            const approveGas = await getGasWithBuffer(publicClient, {
              address: ARCADE_TOKEN_ADDRESS, abi: ERC20_ABI,
              functionName: "approve", args: approveArgs, account: address,
            });
            const ah = await writeContract(wagmiAdapter.wagmiConfig, {
              address: ARCADE_TOKEN_ADDRESS, abi: ERC20_ABI,
              functionName: "approve", args: approveArgs,
              gas: approveGas, chainId: CHAIN_ID,
            });
            await waitForTransactionReceipt(wagmiAdapter.wagmiConfig, { hash: ah });
          }
          const transferArgs = [MARKETPLACE_ADDRESS, priceWei];
          const transferGas = await getGasWithBuffer(publicClient, {
            address: ARCADE_TOKEN_ADDRESS, abi: ERC20_ABI,
            functionName: "transfer", args: transferArgs, account: address,
          });
          const hash = await writeContract(wagmiAdapter.wagmiConfig, {
            address: ARCADE_TOKEN_ADDRESS, abi: ERC20_ABI,
            functionName: "transfer", args: transferArgs,
            gas: transferGas, chainId: CHAIN_ID,
          });
          await waitForTransactionReceipt(wagmiAdapter.wagmiConfig, { hash });
      }

      unlockAvatarStyle(address, style.id);
      setUnlockedStyles(getUnlockedStyles(address));
      setMsg(`✅ ${style.label} style unlocked! Now activate it.`);
      await fetchData();
    } catch (err) {
      setMsg(err.message?.includes("user rejected") ? "Cancelled." : "Error: " + (err.shortMessage || err.message));
    }
    finally { setBuying(false); }
  };

  const handleActivateStyle = (styleId) => {
    if (!address) return;
    setActiveAvatarStyle(address, styleId);
    setActiveStyle(styleId);
    setMsg(`✅ Avatar updated to ${AVATAR_STYLES.find(s => s.id === styleId)?.label}!`);
  };

  const fetchBadges = async () => {
    if (!publicClient || !CAMPAIGN_BADGE_ADDRESS) { setBadgesLoading(false); return; }
    setBadgesLoading(true);
    try {
      const ids = Object.values(BADGE_TYPE_IDS);
      const onChain = await Promise.all(
        ids.map(id => publicClient.readContract({
          address: CAMPAIGN_BADGE_ADDRESS, abi: CAMPAIGN_BADGE_ABI,
          functionName: "getBadgeType", args: [BigInt(id)],
        }))
      );

      let claimedFlags = ids.map(() => false);
      let eligibility = {};
      if (address) {
        claimedFlags = await Promise.all(
          ids.map(id => publicClient.readContract({
            address: CAMPAIGN_BADGE_ADDRESS, abi: CAMPAIGN_BADGE_ABI,
            functionName: "hasClaimed", args: [address, BigInt(id)],
          }))
        );
        try {
          const res = await fetch(`/api/badges/status?wallet=${address}`);
          const data = await res.json();
          eligibility = data.eligibility || {};
        } catch (e) { console.error("Failed to fetch badge eligibility:", e); }
      }

      setBadges(ids.map((id, i) => ({
        badgeTypeId: id,
        ...BADGE_META[id],
        maxSupply: Number(onChain[i].maxSupply),
        minted: Number(onChain[i].minted),
        imageURI: onChain[i].imageURI,
        active: onChain[i].active,
        owned: claimedFlags[i],
        eligible: !!eligibility[BADGE_META[id].key],
      })));
    } catch (err) {
      console.error("Failed to fetch badges:", err);
    } finally {
      setBadgesLoading(false);
    }
  };

  useEffect(() => { fetchBadges(); }, [publicClient, address, CAMPAIGN_BADGE_ADDRESS]);

 const handleClaimBadge = async (badge) => {
    if (!address) return;
    setClaiming(true);
    setClaimingId(badge.badgeTypeId);
    setMsg("");
    try {
      const token = localStorage.getItem("arcadex_jwt");
      const res = await fetch("/api/badges/sign-claim", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        // YAHAN CHANGE HAI: CHAIN_ID aur CAMPAIGN_BADGE_ADDRESS add kiya hai
        body: JSON.stringify({ 
           badgeTypeId: badge.badgeTypeId,
           chainId: CHAIN_ID,
           contractAddress: CAMPAIGN_BADGE_ADDRESS
        }),
      });
      
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Not eligible for this badge yet");

  
      const claimGas = await getGasWithBuffer(publicClient, {
        address: CAMPAIGN_BADGE_ADDRESS, abi: CAMPAIGN_BADGE_ABI,
        functionName: "claimBadge", args: [BigInt(badge.badgeTypeId), data.signature], account: address,
      });
      const hash = await writeContract(wagmiAdapter.wagmiConfig, {
        address: CAMPAIGN_BADGE_ADDRESS, abi: CAMPAIGN_BADGE_ABI,
        functionName: "claimBadge",
        args: [BigInt(badge.badgeTypeId), data.signature],
        gas: claimGas,
        chainId: CHAIN_ID,
      });
      await waitForTransactionReceipt(wagmiAdapter.wagmiConfig, { hash });
      setMsg(`🎉 ${badge.name} minted! Welcome to the club.`);
      await fetchBadges();
    } catch (err) {
      const errMsg = err.message?.includes("user rejected") ? "Transaction cancelled."
        : "Error: " + (err.shortMessage || err.message);
      setMsg(errMsg);
    } finally {
      setClaiming(false);
      setClaimingId(null);
    }
  };

  const handleBuyArcade = async () => {
    if (!address || !botAmount) return;
    const botAmt = Number(botAmount);
    const botBal = Number(botBalance?.formatted || 0);
    if (botAmt <= 0) { setMsg("Error: Enter a valid BOT amount."); return; }
    if (botAmt > botBal) { setMsg(`Error: Insufficient BOT balance. You have ${botBal.toFixed(4)} BOT.`); return; }

    setSwapping(true);
    setMsg("");
    try {
      const buyArcadeGas = await getGasWithBuffer(publicClient, {
        address: MARKETPLACE_ADDRESS, abi: MARKETPLACE_ABI,
        functionName: "buyArcadeWithBot", args: [], account: address, value: BigInt(Math.floor(botAmt * 1e18))
      });
      const hash = await writeContract(wagmiAdapter.wagmiConfig, {
        address: MARKETPLACE_ADDRESS,
        abi: MARKETPLACE_ABI,
        functionName: "buyArcadeWithBot",
        value: BigInt(Math.floor(botAmt * 1e18)),
        gas: buyArcadeGas,
        chainId: CHAIN_ID,
      });
      await waitForTransactionReceipt(wagmiAdapter.wagmiConfig, { hash });
      setMsg(`✓ Successfully bought ${(botAmt * arcadePerBot).toLocaleString()} ${tokenName}!`);
      await fetchData();
    } catch (err) {
      const msg = err.message?.includes("insufficient") ? `Insufficient ${NATIVE_SYMBOL} balance for this transaction.`
        : err.message?.includes("user rejected") ? "Transaction cancelled."
        : "Error: " + (err.shortMessage || err.message);
      setMsg(msg);
    }
    finally { setSwapping(false); }
  };

  const handleBuyItemWithArcade = async (item) => {
    if (!address) return;
    const price = Number(item.arcadePrice) / 1e18;

    if (arcadeBalance < price) {
      setMsg(`❌ Insufficient ${tokenName}! You need ${price.toLocaleString()} ${tokenName} but have ${arcadeBalance.toLocaleString()}.`);
      return;
    }

    setBuying(true);
    setBuyingId(Number(item.id));
    setMsg("");
    try {
      // ── ERC20 Approve logic (Skipped for Native MSTC) ──
      if (rewardType !== "native") {
          const allowance = await publicClient.readContract({
            address: ARCADE_TOKEN_ADDRESS, abi: ERC20_ABI,
            functionName: "allowance", args: [address, MARKETPLACE_ADDRESS],
          });
          if (BigInt(allowance) < BigInt(item.arcadePrice)) {
            setMsg(`⏳ Step 1/2: Approving ${tokenName} spend...`);
            const approveArgs = [MARKETPLACE_ADDRESS, item.arcadePrice];
            const approveGas = await getGasWithBuffer(publicClient, {
              address: ARCADE_TOKEN_ADDRESS, abi: ERC20_ABI,
              functionName: "approve", args: approveArgs, account: address,
            });
            const approveHash = await writeContract(wagmiAdapter.wagmiConfig, {
              address: ARCADE_TOKEN_ADDRESS, abi: ERC20_ABI,
              functionName: "approve",
              args: approveArgs,
              gas: approveGas,
              chainId: CHAIN_ID,
            });
            await waitForTransactionReceipt(wagmiAdapter.wagmiConfig, { hash: approveHash });
          }
      }

      setMsg("⏳ Step 2/2: Purchasing item...");
      const buyArgs = [BigInt(item.id)];
      // If Native MST chain, pass value, else 0
      const valueAmount = rewardType === "native" ? BigInt(item.arcadePrice) : 0n;
      
      const buyGas = await getGasWithBuffer(publicClient, {
        address: MARKETPLACE_ADDRESS, abi: MARKETPLACE_ABI,
        functionName: "buyItemWithArcade", args: buyArgs, account: address, value: valueAmount
      });
      const hash = await writeContract(wagmiAdapter.wagmiConfig, {
        address: MARKETPLACE_ADDRESS, abi: MARKETPLACE_ABI,
        functionName: "buyItemWithArcade",
        args: buyArgs,
        gas: buyGas,
        chainId: CHAIN_ID,
        value: valueAmount
      });
      await waitForTransactionReceipt(wagmiAdapter.wagmiConfig, { hash });
      setMsg(`✅ ${item.name} purchased with ${tokenName}!`);
      await fetchData();
    } catch (err) {
      const errMsg = err.message?.includes("user rejected") ? "Transaction cancelled."
        : err.message?.includes("insufficient") ? `Insufficient ${tokenName} balance.`
        : "Error: " + (err.shortMessage || err.message);
      setMsg(errMsg);
    }
    finally { setBuying(false); setBuyingId(null); }
  };

  const handleBuyItemWithBot = async (item) => {
    if (!address) return;
    const botPrice = Number(item.botPrice) / 1e18;
    const botBal = Number(botBalance?.formatted || 0);

    if (botBal < botPrice) {
      setMsg(`❌ Insufficient BOT! You need ${botPrice} BOT but have ${botBal.toFixed(4)} BOT.`);
      return;
    }

    setBuying(true);
    setBuyingId(Number(item.id));
    setMsg("");
    try {
      const buyBotArgs = [BigInt(item.id)];
      const buyBotGas = await getGasWithBuffer(publicClient, {
        address: MARKETPLACE_ADDRESS, abi: MARKETPLACE_ABI,
        functionName: "buyItemWithBot", args: buyBotArgs, account: address, value: BigInt(item.botPrice)
      });
      const hash = await writeContract(wagmiAdapter.wagmiConfig, {
        address: MARKETPLACE_ADDRESS, abi: MARKETPLACE_ABI,
        functionName: "buyItemWithBot",
        args: buyBotArgs,
        value: BigInt(item.botPrice),
        gas: buyBotGas,
        chainId: CHAIN_ID,
      });
      await waitForTransactionReceipt(wagmiAdapter.wagmiConfig, { hash });
      setMsg(`✅ ${item.name} purchased with ${NATIVE_SYMBOL}!`);
      await fetchData();
    } catch (err) {
      const errMsg = err.message?.includes("user rejected") ? "Transaction cancelled."
        : err.message?.includes("insufficient") ? `Insufficient ${NATIVE_SYMBOL} balance.`
        : "Error: " + (err.shortMessage || err.message);
      setMsg(errMsg);
    }
    finally { setBuying(false); setBuyingId(null); }
  };

  const filteredItems = items.filter(item => {
    if (activeFilter === "all") return true;
    if (activeFilter === "arcade") return Number(item.arcadePrice) > 0;
    if (activeFilter === "bot") return Number(item.botPrice) > 0;
    if (activeFilter === "badge") return Number(item.itemType) === 0;
    if (activeFilter === "frame") return Number(item.itemType) === 1;
    if (activeFilter === "powerup") return Number(item.itemType) === 2;
    return true;
  });

  const myItems = items.filter(i => userItems.includes(Number(i.id)));
  const arcadeYouGet = Number(botAmount) * arcadePerBot;

  return (
    <div style={{ minHeight: "calc(100vh - 54px)", background: P.bg, position: "relative", overflow: "hidden" }}>
      <style>{`
        @keyframes floatParticle { 0%{transform:translateY(0);opacity:0.5} 100%{transform:translateY(-120px);opacity:0} }
        @keyframes shimmer { 0%{background-position:-200% 0} 100%{background-position:200% 0} }
        @keyframes slideUp { from{opacity:0;transform:translateY(16px)} to{opacity:1;transform:translateY(0)} }
        @keyframes gradientShift { 0%,100%{background-position:0% 50%} 50%{background-position:100% 50%} }
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.4} }
        @keyframes coinSpin { 0%{transform:rotateY(0deg)} 100%{transform:rotateY(360deg)} }
        @keyframes badgePulse { 0%,100%{opacity:1;transform:scale(1)} 50%{opacity:0.4;transform:scale(1.4)} }
        @keyframes badgeGlowPulse { 0%,100%{opacity:0.6;transform:translateX(-50%) scale(1)} 50%{opacity:1;transform:translateX(-50%) scale(1.12)} }
        @keyframes badgeGlowPulseCentered { 0%,100%{opacity:0.6;transform:scale(1)} 50%{opacity:1;transform:scale(1.12)} }
        .filter-btn:hover { border-color: rgba(123,47,255,0.4) !important; color: #c4a0ff !important; }
        .tab-btn:hover { color: #c4a0ff !important; }
        .swap-input:focus { outline: none; border-color: rgba(0,212,255,0.5) !important; }
        .badge-card { will-change: transform; }
        .badge-card:hover { transform: translateY(-8px); }
        .badge-card:hover .badge-img { transform: scale(1.08) rotate(-2deg); }
        .claim-btn:hover:not(:disabled) { transform: translateY(-2px) scale(1.02); }
      `}</style>

      {/* Particles */}
      <div style={{ position: "fixed", inset: 0, pointerEvents: "none", zIndex: 0 }}>
        {Array.from({ length: 15 }).map((_, i) => (
          <div key={i} style={{ position: "absolute", left: `${Math.random() * 100}%`, top: `${Math.random() * 100}%`, width: Math.random() * 3 + 1, height: Math.random() * 3 + 1, borderRadius: "50%", background: i % 3 === 0 ? "#FFB700" : i % 3 === 1 ? "#7B2FFF" : "#00d4ff", opacity: 0.3, animation: `floatParticle ${Math.random() * 3 + 2}s ${Math.random() * 4}s ease-in-out infinite` }} />
        ))}
        <div style={{ position: "absolute", inset: 0, backgroundImage: "linear-gradient(rgba(123,47,255,0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(123,47,255,0.03) 1px, transparent 1px)", backgroundSize: "50px 50px" }} />
      </div>

      <div style={{ position: "relative", zIndex: 1, padding: isMobile ? "16px" : "28px 36px" }}>

        {/* Header */}
        <div style={{ marginBottom: 20, animation: "slideUp 0.5s ease forwards" }}>
          <div style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "4px 12px", border: "1px solid rgba(255,183,0,0.25)", borderRadius: 4, fontSize: 9, color: "rgba(255,183,0,0.7)", letterSpacing: "2px", textTransform: "uppercase", marginBottom: 10, background: "rgba(255,183,0,0.06)", fontFamily: P.raj, fontWeight: 600 }}>
            <span style={{ width: 5, height: 5, borderRadius: "50%", background: "#FFB700", animation: "pulse 1.5s ease-in-out infinite" }} />
            ArcadeX Marketplace
          </div>
          <h1 style={{ fontFamily: P.raj, fontWeight: 700, fontSize: isMobile ? 28 : 44, letterSpacing: "-0.5px", textTransform: "uppercase", lineHeight: 0.95, color: "#fff", margin: "0 0 8px" }}>
            MARKET<br />
            <span style={{ background: "linear-gradient(90deg,#7B2FFF,#00d4ff,#7B2FFF)", backgroundSize: "200% 100%", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", animation: "gradientShift 3s ease infinite" }}>PLACE</span>
          </h1>
          <p style={{ color: "#5533aa", fontSize: 12, fontFamily: P.raj }}>Buy badges, frames & power-ups with {tokenName} or {NATIVE_SYMBOL}</p>
        </div>

      {/* Balance cards */}
        {isConnected && (
          <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr 1fr" : (rewardType === "native" ? "1fr 1fr" : "repeat(3,1fr)"), gap: 10, marginBottom: 20 }}>
            {[
              // ARCADE Box sirf ERC-20 chains par dikhega
              ...(rewardType !== "native" ? [{ label: `${tokenName} Balance`, value: arcadeBalance.toLocaleString(), color: "#a67fff", icon: "🎮", sub: "Available to spend" }] : []),
              { label: `${NATIVE_SYMBOL} Balance`, value: Number(botBalance?.formatted || 0).toFixed(4), color: "#00d4ff", icon: "⛓️", sub: "Native token" },
              { label: "Active Style", value: AVATAR_STYLES.find(s => s.id === activeStyle)?.label || "Bottts", color: "#00FF88", icon: "🎨", sub: "Your avatar style" },
            ].map(s => (
              <div key={s.label} style={{ background: P.s1, border: `1px solid ${P.b}`, borderRadius: 12, padding: isMobile ? "12px" : "16px 20px", position: "relative", overflow: "hidden" }}>
                <div style={{ position: "absolute", top: -20, right: -20, width: 80, height: 80, background: `radial-gradient(circle,${s.color}15 0%,transparent 70%)`, borderRadius: "50%", pointerEvents: "none" }} />
                <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 5 }}>
                  <span style={{ fontSize: isMobile ? 14 : 18 }}>{s.icon}</span>
                  <div style={{ fontSize: 8, color: "#5533aa", fontFamily: P.raj, fontWeight: 700, textTransform: "uppercase", letterSpacing: "1px" }}>{s.label}</div>
                </div>
                <div style={{ fontFamily: P.orb, fontWeight: 700, fontSize: isMobile ? 16 : 22, color: s.color, letterSpacing: "-0.5px" }}>{s.value}</div>
                <div style={{ fontSize: 9, color: "#3a2a5a", fontFamily: P.raj, marginTop: 2 }}>{s.sub}</div>
              </div>
            ))}
          </div>
        )}

        {/* Tabs */}
        <div style={{ display: "flex", gap: 0, marginBottom: 24, borderBottom: "1px solid rgba(123,47,255,0.15)", flexWrap: "wrap" }}>
         {[
  { id: "avatar", label: "🎨 Avatar Styles" },
  // Tab sirf tabhi dikhega jab token ERC-20 (ARCADE) ho
  ...(rewardType !== "native" ? [{ id: "buy-arcade", label: `💱 Buy ${tokenName}` }] : []),
  { id: "badges", label: "🏆 Campaign Badges" },
].map(t => (
            <button key={t.id} className="tab-btn" onClick={() => setActiveTab(t.id)} style={{ padding: "10px 22px", background: "transparent", border: "none", borderBottom: activeTab === t.id ? "2px solid #7B2FFF" : "2px solid transparent", color: activeTab === t.id ? "#c4a0ff" : "#3a2a5a", fontSize: 12, cursor: "pointer", marginBottom: "-1px", fontFamily: P.raj, fontWeight: 700, letterSpacing: "0.5px", textTransform: "uppercase", transition: "color 0.18s" }}>
              {t.label}
            </button>
          ))}
        </div>

        {/* Msg */}
        {msg && (
          <div style={{ marginBottom: 16, padding: "12px 18px", background: msg.startsWith("✓") || msg.startsWith("✅") || msg.startsWith("🎉") ? "rgba(0,255,136,0.06)" : "rgba(255,68,68,0.06)", border: `1px solid ${msg.startsWith("✓") || msg.startsWith("✅") || msg.startsWith("🎉") ? "rgba(0,255,136,0.2)" : "rgba(255,68,68,0.2)"}`, borderRadius: 10, fontSize: 12, color: msg.startsWith("✓") || msg.startsWith("✅") || msg.startsWith("🎉") ? "#00FF88" : "#ff4444", fontFamily: P.raj, fontWeight: 700, display: "flex", justifyContent: "space-between" }}>
            {msg}
            <button onClick={() => setMsg("")} style={{ background: "none", border: "none", color: "inherit", cursor: "pointer" }}>✕</button>
          </div>
        )}

        {/* SHOP TAB */}
        {activeTab === "shop" && (
          <div>
            {/* Filters */}
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 20 }}>
              {[
                { id: "all", label: "All" },
                { id: "arcade", label: `🎮 ${tokenName}` },
                { id: "bot", label: `⛓️ ${NATIVE_SYMBOL}` },
                { id: "badge", label: "🏅 Badges" },
                { id: "frame", label: "🖼️ Frames" },
                { id: "powerup", label: "⚡ Power-Ups" },
              ].map(f => (
                <button key={f.id} className="filter-btn" onClick={() => setActiveFilter(f.id)} style={{ padding: "7px 16px", borderRadius: 20, border: `1px solid ${activeFilter === f.id ? "rgba(123,47,255,0.5)" : "rgba(123,47,255,0.15)"}`, background: activeFilter === f.id ? "rgba(123,47,255,0.2)" : "transparent", color: activeFilter === f.id ? "#c4a0ff" : "#5533aa", fontSize: 11, cursor: "pointer", fontFamily: P.raj, fontWeight: 700, letterSpacing: "0.5px", transition: "all 0.2s" }}>
                  {f.label}
                </button>
              ))}
            </div>

            {loading ? (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(240px,1fr))", gap: 16 }}>
                {[1, 2, 3, 4, 5, 6].map(i => (
                  <div key={i} style={{ height: 300, borderRadius: 16, background: "linear-gradient(90deg,rgba(123,47,255,0.06) 25%,rgba(123,47,255,0.12) 50%,rgba(123,47,255,0.06) 75%)", backgroundSize: "200% 100%", animation: "shimmer 1.5s infinite", border: "1px solid rgba(123,47,255,0.1)" }} />
                ))}
              </div>
            ) : (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(240px,1fr))", gap: 16 }}>
                {filteredItems.map((item, i) => (
                  <div key={Number(item.id)} style={{ animation: `slideUp 0.4s ${i * 0.05}s ease both` }}>
                    <ItemCard item={item} owned={userItems.includes(Number(item.id))} onBuyArcade={handleBuyItemWithArcade} onBuyBot={handleBuyItemWithBot} buying={buying} buyingId={buyingId} arcadeBalance={arcadeBalance} botBalance={botBalance} tokenName={tokenName} />
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* AVATAR STYLES TAB */}
        {activeTab === "avatar" && (
          <div>
            {!isConnected ? (
              <div style={{ padding: "60px 0", textAlign: "center" }}>
                <div style={{ fontSize: 48, marginBottom: 16 }}>🎨</div>
                <div style={{ fontFamily: P.raj, fontWeight: 700, fontSize: 16, color: "#c4a0ff" }}>Connect wallet to customize your avatar</div>
              </div>
            ) : (
              <div>
                {/* Current avatar preview */}
                <div style={{ display: "flex", alignItems: "center", gap: 20, padding: "20px 24px", background: "rgba(123,47,255,0.06)", border: "1px solid rgba(123,47,255,0.18)", borderRadius: 12, marginBottom: 24 }}>
                  <div style={{ width: 80, height: 80, borderRadius: "50%", overflow: "hidden", border: "2px solid rgba(123,47,255,0.6)", boxShadow: "0 0 24px rgba(123,47,255,0.4)", flexShrink: 0, background: "#0e0c1a" }}>
                    <img src={`https://api.dicebear.com/9.x/${activeStyle}/svg?seed=${address}`} alt="current avatar" style={{ width: "100%", height: "100%" }} />
                  </div>
                  <div>
                    <div style={{ fontFamily: P.raj, fontWeight: 700, fontSize: 18, color: "#fff", marginBottom: 4 }}>Your Avatar</div>
                    <div style={{ fontSize: 12, color: "#5533aa", fontFamily: P.raj }}>Active style: <span style={{ color: TIER_COLOR[AVATAR_STYLES.find(s => s.id === activeStyle)?.tier] || "#a67fff", fontWeight: 700 }}>{AVATAR_STYLES.find(s => s.id === activeStyle)?.label || activeStyle}</span></div>
                    <div style={{ fontSize: 11, color: "#3a2a5a", fontFamily: P.raj, marginTop: 4 }}>Unlocked: {unlockedStyles.length} / {AVATAR_STYLES.length} styles</div>
                  </div>
                </div>

                {/* Style grid */}
                <div style={{ display: "grid", gridTemplateColumns: isMobile ? "repeat(2, 1fr)" : "repeat(auto-fill, minmax(180px, 1fr))", gap: isMobile ? 10 : 14 }}>
                  {AVATAR_STYLES.map(style => {
                    const isUnlocked = unlockedStyles.includes(style.id);
                    const isActive = activeStyle === style.id;
                    const tierColor = TIER_COLOR[style.tier];
                    return (
                      <div key={style.id} style={{
                        background: isActive ? "rgba(123,47,255,0.15)" : "rgba(10,8,20,0.9)",
                        border: `${isActive ? "2px" : "1px"} solid ${isActive ? "rgba(123,47,255,0.8)" : "rgba(123,47,255,0.15)"}`,
                        borderRadius: 14, overflow: "hidden",
                        boxShadow: isActive ? "0 0 20px rgba(123,47,255,0.4)" : "none",
                        transition: "all 0.2s",
                      }}>
                        <div style={{ height: 120, background: "rgba(123,47,255,0.05)", display: "flex", alignItems: "center", justifyContent: "center", position: "relative" }}>
                          <div style={{ width: 80, height: 80, borderRadius: "50%", overflow: "hidden", border: `2px solid ${tierColor}44`, background: "#0e0c1a" }}>
                            <img src={`https://api.dicebear.com/9.x/${style.id}/svg?seed=${address}`} alt={style.label} style={{ width: "100%", height: "100%" }} />
                          </div>
                          <div style={{ position: "absolute", top: 8, left: 8, padding: "2px 8px", borderRadius: 4, background: `${tierColor}22`, border: `1px solid ${tierColor}44`, color: tierColor, fontSize: 9, fontFamily: P.raj, fontWeight: 700, letterSpacing: "1px" }}>
                            {style.tier.toUpperCase()}
                          </div>
                          {isActive && (
                            <div style={{ position: "absolute", top: 8, right: 8, width: 20, height: 20, borderRadius: "50%", background: "#00FF88", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11 }}>✓</div>
                          )}
                          {!isUnlocked && (
                            <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.55)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 24 }}>🔒</div>
                          )}
                        </div>

                        <div style={{ padding: "10px 12px" }}>
                          <div style={{ fontFamily: P.raj, fontWeight: 700, fontSize: 13, color: "#e0d0ff", marginBottom: 2 }}>{style.label}</div>
                          <div style={{ fontSize: 10, color: "#5533aa", fontFamily: P.raj, marginBottom: 10 }}>{style.desc}</div>

                          {isActive ? (
                            <div style={{ padding: "7px", background: "rgba(0,255,136,0.08)", border: "1px solid rgba(0,255,136,0.2)", borderRadius: 7, textAlign: "center", fontSize: 11, color: "#00FF88", fontFamily: P.raj, fontWeight: 700 }}>✓ Active</div>
                          ) : isUnlocked ? (
                            <button onClick={() => handleActivateStyle(style.id)} style={{ width: "100%", padding: "7px", background: "rgba(123,47,255,0.15)", border: "1px solid rgba(123,47,255,0.35)", borderRadius: 7, color: "#c4a0ff", fontSize: 11, cursor: "pointer", fontFamily: P.raj, fontWeight: 700 }}>
                              Set Active
                            </button>
                          ) : (
                            <button onClick={() => handleUnlockStyle(style)} disabled={buying || arcadeBalance < style.price} style={{
                              width: "100%", padding: "7px",
                              background: arcadeBalance < style.price ? "rgba(255,68,68,0.06)" : "linear-gradient(135deg,#7B2FFF,#5a1fd4)",
                              border: arcadeBalance < style.price ? "1px solid rgba(255,68,68,0.2)" : "none",
                              borderRadius: 7,
                              color: arcadeBalance < style.price ? "#ff4444" : "#fff",
                              fontSize: 11, cursor: (buying || arcadeBalance < style.price) ? "not-allowed" : "pointer",
                              fontFamily: P.raj, fontWeight: 700,
                            }}>
                              {style.price === 0 ? "Unlock Free" : arcadeBalance < style.price ? `Need ${style.price} ${tokenName}` : `🔓 ${style.price} ${tokenName}`}
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}

        {/* BUY ARCADE TAB */}
        {activeTab === "buy-arcade" && (
          <div style={{ maxWidth: 480, margin: "0 auto", animation: "slideUp 0.4s ease forwards" }}>

            <div style={{ background: "linear-gradient(135deg,rgba(0,212,255,0.1),rgba(123,47,255,0.1))", border: "1px solid rgba(0,212,255,0.2)", borderRadius: 16, padding: 20, marginBottom: 20, textAlign: "center" }}>
              <div style={{ fontSize: 12, color: "#5533aa", fontFamily: P.raj, fontWeight: 700, textTransform: "uppercase", letterSpacing: "1.5px", marginBottom: 12 }}>Exchange Rate</div>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 16 }}>
                <div style={{ textAlign: "center" }}>
                  <div style={{ fontSize: 28, marginBottom: 4, animation: "coinSpin 3s linear infinite" }}>⛓️</div>
                  <div style={{ fontFamily: P.orb, fontWeight: 700, fontSize: 20, color: "#00d4ff" }}>1 {NATIVE_SYMBOL}</div>
                </div>
                <div style={{ fontSize: 24, color: "#5533aa" }}>→</div>
                <div style={{ textAlign: "center" }}>
                  <div style={{ fontSize: 28, marginBottom: 4 }}>🎮</div>
                  <div style={{ fontFamily: P.orb, fontWeight: 700, fontSize: 20, color: "#a67fff" }}>{arcadePerBot.toLocaleString()} {tokenName}</div>
                </div>
              </div>
            </div>

            <div style={{ background: P.s1, border: `1px solid ${P.b2}`, borderRadius: 16, padding: 24 }}>
              <div style={{ fontFamily: P.raj, fontWeight: 700, fontSize: 16, color: "#fff", marginBottom: 20 }}>💱 Buy {tokenName} with {NATIVE_SYMBOL}</div>

              <div style={{ marginBottom: 16 }}>
                <label style={{ fontSize: 9, color: "#5533aa", fontFamily: P.raj, fontWeight: 700, textTransform: "uppercase", letterSpacing: "1.2px", display: "block", marginBottom: 6 }}>You Pay ({NATIVE_SYMBOL})</label>
                <div style={{ position: "relative" }}>
                  <input className="swap-input" type="number" value={botAmount} onChange={e => setBotAmount(e.target.value)} step="0.01" min="0.01" style={{ width: "100%", padding: "14px 80px 14px 14px", background: "rgba(0,212,255,0.05)", border: "1px solid rgba(0,212,255,0.2)", borderRadius: 10, color: "#00d4ff", fontSize: 18, fontFamily: P.orb, fontWeight: 700, boxSizing: "border-box", transition: "border-color 0.2s" }} />
                  <div style={{ position: "absolute", right: 14, top: "50%", transform: "translateY(-50%)", fontSize: 12, color: "#00d4ff", fontFamily: P.raj, fontWeight: 700 }}>{NATIVE_SYMBOL}</div>
                </div>
              </div>

              <div style={{ display: "flex", gap: 6, marginBottom: 16 }}>
                {["0.1", "0.5", "1", "5"].map(amt => (
                  <button key={amt} onClick={() => setBotAmount(amt)} style={{ flex: 1, padding: "6px 0", background: botAmount === amt ? "rgba(0,212,255,0.15)" : "rgba(0,0,0,0.3)", border: `1px solid ${botAmount === amt ? "rgba(0,212,255,0.4)" : "rgba(123,47,255,0.1)"}`, borderRadius: 6, color: botAmount === amt ? "#00d4ff" : "#5533aa", fontSize: 11, cursor: "pointer", fontFamily: P.raj, fontWeight: 700, transition: "all 0.15s" }}>
                    {amt}
                  </button>
                ))}
              </div>

              <div style={{ background: "rgba(0,0,0,0.3)", border: "1px solid rgba(123,47,255,0.1)", borderRadius: 10, padding: "14px", marginBottom: 20 }}>
                <div style={{ fontSize: 9, color: "#5533aa", fontFamily: P.raj, fontWeight: 700, textTransform: "uppercase", letterSpacing: "1.2px", marginBottom: 6 }}>You Receive ({tokenName})</div>
                <div style={{ fontFamily: P.orb, fontWeight: 700, fontSize: 24, color: "#a67fff" }}>{(Number(botAmount) * arcadePerBot).toLocaleString()}</div>
              </div>

              {isConnected ? (
                <button onClick={handleBuyArcade} disabled={swapping || !botAmount} style={{ width: "100%", padding: "14px", background: swapping ? "rgba(123,47,255,0.2)" : "linear-gradient(135deg,#7B2FFF,#5a1fd4)", border: "none", borderRadius: 10, color: swapping ? "#5533aa" : "#fff", fontSize: 13, fontWeight: 700, cursor: swapping ? "not-allowed" : "pointer", fontFamily: P.raj, letterSpacing: "1px", textTransform: "uppercase", transition: "all 0.2s" }}>
                  {swapping ? "Processing..." : `Buy ${(Number(botAmount) * arcadePerBot).toLocaleString()} ${tokenName}`}
                </button>
              ) : (
                <div style={{ textAlign: "center", padding: 14, background: "rgba(123,47,255,0.06)", border: "1px solid rgba(123,47,255,0.2)", borderRadius: 10, fontSize: 12, color: "#5533aa", fontFamily: P.raj }}>
                  Connect wallet to buy {tokenName}
                </div>
              )}
            </div>

            <div style={{ marginTop: 16, padding: 14, background: "rgba(255,183,0,0.05)", border: "1px solid rgba(255,183,0,0.15)", borderRadius: 10 }}>
              <div style={{ fontSize: 10, color: "#FFB700", fontFamily: P.raj, fontWeight: 700, marginBottom: 6 }}>ℹ️ How it works</div>
              <div style={{ fontSize: 11, color: "#7755aa", fontFamily: P.raj, lineHeight: 1.6 }}>
                Send {NATIVE_SYMBOL} to get {tokenName} tokens instantly. {tokenName} can be used to join tournaments, buy badges, and more!
              </div>
            </div>
          </div>
        )}

        {/* BADGES TAB */}
        {activeTab === "badges" && (
          <div>
            <div style={{ marginBottom: 28, textAlign: "center" }}>
              <div style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "5px 14px", border: "1px solid rgba(255,183,0,0.3)", borderRadius: 20, fontSize: 9, color: "#FFB700", letterSpacing: "2px", textTransform: "uppercase", marginBottom: 14, background: "rgba(255,183,0,0.07)", fontFamily: P.raj, fontWeight: 700 }}>
                <span style={{ width: 5, height: 5, borderRadius: "50%", background: "#FFB700", animation: "badgePulse 1.5s ease-in-out infinite" }} />
                Limited Edition · On-Chain
              </div>
              <div style={{ fontFamily: P.raj, fontWeight: 700, fontSize: 28, color: "#fff", marginBottom: 8, textTransform: "uppercase", letterSpacing: "-0.3px" }}>
                Campaign <span style={{ background: "linear-gradient(90deg,#FFB700,#FF6B00,#FFB700)", backgroundSize: "200% 100%", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", animation: "gradientShift 3s ease infinite" }}>Badges</span>
              </div>
              <div style={{ fontSize: 12, color: "#7755aa", fontFamily: P.raj }}>Verifiable proof of participation — permanently yours, free to claim once you're eligible.</div>
            </div>

            {!isConnected ? (
              <div style={{ padding: "60px 0", textAlign: "center" }}>
                <div style={{ fontSize: 48, marginBottom: 16 }}>🏆</div>
                <div style={{ fontFamily: P.raj, fontWeight: 700, fontSize: 16, color: "#c4a0ff" }}>Connect wallet to see your badges</div>
              </div>
            ) : badgesLoading ? (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(240px,1fr))", gap: 18 }}>
                {[1, 2, 3].map(i => (
                  <div key={i} style={{ height: 340, borderRadius: 18, background: "linear-gradient(90deg, rgba(123,47,255,0.06) 25%, rgba(123,47,255,0.12) 50%, rgba(123,47,255,0.06) 75%)", backgroundSize: "200% 100%", animation: "shimmer 1.5s infinite", border: "1px solid rgba(123,47,255,0.1)" }} />
                ))}
              </div>
            ) : !CAMPAIGN_BADGE_ADDRESS ? (
              <div style={{ padding: "60px 0", textAlign: "center" }}>
                <div style={{ fontSize: 48, marginBottom: 16 }}>🚧</div>
                <div style={{ fontFamily: P.raj, fontWeight: 700, fontSize: 16, color: "#c4a0ff" }}>Campaign badges coming soon</div>
              </div>
            ) : (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(240px,1fr))", gap: 18 }}>
                {badges.map((badge, i) => {
                  const fillPct = badge.maxSupply > 0 ? (badge.minted / badge.maxSupply) * 100 : 0;
                  const soldOut = badge.minted >= badge.maxSupply;
                  const isClaiming = claiming && claimingId === badge.badgeTypeId;
                  const isPremiumTier = badge.key === "legend" || badge.key === "builder";
                  const isUnlocked = badge.owned || badge.eligible;

                  return (
                    <div key={badge.badgeTypeId} className="badge-card" style={{
                      background: `linear-gradient(160deg, ${badge.tier}0c 0%, rgba(10,8,20,0.95) 60%)`,
                      border: `1px solid ${badge.owned ? "rgba(0,255,136,0.4)" : isUnlocked ? `${badge.tier}55` : "rgba(123,47,255,0.15)"}`,
                      borderRadius: 18, overflow: "hidden", animation: `slideUp 0.4s ${i * 0.05}s ease both`,
                      position: "relative", transition: "transform 0.3s cubic-bezier(0.4,0,0.2,1), box-shadow 0.3s ease, border-color 0.3s ease",
                      cursor: "default",
                    }}>
                      <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 2, background: `linear-gradient(90deg, transparent, ${badge.tier}, transparent)`, opacity: isUnlocked ? 1 : 0.3 }} />

                      {isPremiumTier && isUnlocked && (
                        <div style={{ position: "absolute", top: -60, left: "50%", transform: "translateX(-50%)", width: 220, height: 220, background: `radial-gradient(circle, ${badge.tier}30 0%, transparent 70%)`, pointerEvents: "none", animation: "badgeGlowPulse 2.5s ease-in-out infinite" }} />
                      )}

                      <div className="badge-image-wrap" style={{ height: 190, display: "flex", alignItems: "center", justifyContent: "center", position: "relative", overflow: "hidden" }}>
                        {isUnlocked && (
                          <div style={{ position: "absolute", width: 180, height: 180, background: `radial-gradient(circle, ${badge.tier}35 0%, transparent 75%)`, borderRadius: "50%", animation: isPremiumTier ? "badgeGlowPulseCentered 2.5s ease-in-out infinite" : "none" }} />
                        )}

                        {badge.imageURI ? (
                          <img src={badge.imageURI} alt={badge.name} className="badge-img" style={{
                            width: 150, height: 150, objectFit: "contain", position: "relative", zIndex: 1,
                            filter: isUnlocked ? `drop-shadow(0 8px 24px ${badge.tier}66)` : "grayscale(0.85) brightness(0.45)",
                            transition: "transform 0.4s cubic-bezier(0.4,0,0.2,1)",
                          }} />
                        ) : (
                          <span style={{ fontSize: 64 }}>🏅</span>
                        )}

                        {!isUnlocked && !soldOut && (
                          <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(5,4,10,0.35)" }}>
                            <span style={{ fontSize: 30, opacity: 0.7 }}>🔒</span>
                          </div>
                        )}

                        {badge.owned && (
                          <div style={{ position: "absolute", top: 12, right: 12, padding: "4px 11px", borderRadius: 20, background: "rgba(0,255,136,0.18)", border: "1px solid rgba(0,255,136,0.4)", color: "#00FF88", fontSize: 10, fontFamily: P.raj, fontWeight: 700, letterSpacing: "1px", boxShadow: "0 0 16px rgba(0,255,136,0.25)" }}>✓ OWNED</div>
                        )}
                        {!badge.owned && soldOut && (
                          <div style={{ position: "absolute", top: 12, right: 12, padding: "4px 11px", borderRadius: 20, background: "rgba(255,68,68,0.18)", border: "1px solid rgba(255,68,68,0.4)", color: "#ff4444", fontSize: 10, fontFamily: P.raj, fontWeight: 700 }}>SOLD OUT</div>
                        )}
                        {!badge.owned && !soldOut && badge.eligible && (
                          <div style={{ position: "absolute", top: 12, left: 12, padding: "4px 11px", borderRadius: 20, background: `${badge.tier}25`, border: `1px solid ${badge.tier}66`, color: badge.tier, fontSize: 9, fontFamily: P.raj, fontWeight: 700, letterSpacing: "1px", display: "flex", alignItems: "center", gap: 5 }}>
                            <span style={{ width: 5, height: 5, borderRadius: "50%", background: badge.tier, animation: "badgePulse 1.2s ease-in-out infinite" }} />
                            UNLOCKED
                          </div>
                        )}
                      </div>

                      <div style={{ padding: "16px 18px" }}>
                        <div style={{ fontFamily: P.raj, fontWeight: 700, fontSize: 17, color: badge.tier, marginBottom: 5, textShadow: isUnlocked ? `0 0 20px ${badge.tier}55` : "none" }}>{badge.name}</div>
                        <div style={{ fontSize: 11, color: "#7755aa", fontFamily: P.raj, marginBottom: 14, lineHeight: 1.5, minHeight: 32 }}>{badge.criteria}</div>

                        <div style={{ marginBottom: 14 }}>
                          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 5 }}>
                            <div style={{ fontSize: 9, color: "#5533aa", fontFamily: P.raj, fontWeight: 700, textTransform: "uppercase", letterSpacing: "1.2px" }}>Minted</div>
                            <div style={{ fontSize: 10, color: badge.tier, fontFamily: P.orb, fontWeight: 700 }}>{badge.minted}/{badge.maxSupply}</div>
                          </div>
                          <div style={{ height: 4, background: "rgba(123,47,255,0.1)", borderRadius: 2, overflow: "hidden" }}>
                            <div style={{ height: "100%", width: `${fillPct}%`, background: fillPct >= 80 ? "linear-gradient(90deg,#ff4444,#ff7700)" : `linear-gradient(90deg,${badge.tier},${badge.tier}aa)`, borderRadius: 2, transition: "width 1s ease", boxShadow: `0 0 8px ${badge.tier}77` }} />
                          </div>
                        </div>

                        {badge.owned ? (
                          <div style={{ padding: "11px", background: "rgba(0,255,136,0.06)", border: "1px solid rgba(0,255,136,0.2)", borderRadius: 9, textAlign: "center", fontSize: 12, color: "#00FF88", fontFamily: P.raj, fontWeight: 700, letterSpacing: "0.5px" }}>
                            ✓ Claimed
                          </div>
                        ) : soldOut ? (
                          <div style={{ padding: "11px", background: "rgba(255,68,68,0.06)", border: "1px solid rgba(255,68,68,0.2)", borderRadius: 9, textAlign: "center", fontSize: 12, color: "#ff4444", fontFamily: P.raj, fontWeight: 700 }}>
                            Sold Out
                          </div>
                        ) : badge.eligible ? (
                          <button onClick={() => handleClaimBadge(badge)} disabled={isClaiming} className="claim-btn" style={{
                            width: "100%", padding: "12px", background: isClaiming ? "rgba(123,47,255,0.2)" : `linear-gradient(135deg, ${badge.tier}, ${badge.tier}cc)`,
                            border: "none", borderRadius: 9, color: isClaiming ? "#5533aa" : "#08070f",
                            fontSize: 12, fontWeight: 700, cursor: isClaiming ? "not-allowed" : "pointer",
                            fontFamily: P.raj, letterSpacing: "1px", textTransform: "uppercase",
                            boxShadow: isClaiming ? "none" : `0 4px 20px ${badge.tier}55`,
                            transition: "transform 0.15s ease, box-shadow 0.15s ease",
                          }}>
                            {isClaiming ? "Minting..." : "🎉 Claim Now"}
                          </button>
                        ) : (
                          <div style={{ padding: "11px", background: "rgba(123,47,255,0.04)", border: "1px solid rgba(123,47,255,0.1)", borderRadius: 9, textAlign: "center", fontSize: 11, color: "#5533aa", fontFamily: P.raj, fontWeight: 700, letterSpacing: "0.5px" }}>
                            🔒 Locked
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* INVENTORY TAB */}
        {activeTab === "inventory" && (
          <div>
            {!isConnected ? (
              <div style={{ padding: "60px 0", textAlign: "center" }}>
                <div style={{ fontSize: 48, marginBottom: 16 }}>🎒</div>
                <div style={{ fontFamily: P.raj, fontWeight: 700, fontSize: 16, color: "#c4a0ff" }}>Connect wallet to see your collection</div>
              </div>
            ) : myItems.length === 0 ? (
              <div style={{ padding: "60px 0", textAlign: "center" }}>
                <div style={{ fontSize: 48, marginBottom: 16 }}>🛒</div>
                <div style={{ fontFamily: P.raj, fontWeight: 700, fontSize: 16, color: "#c4a0ff", marginBottom: 8 }}>Your collection is empty</div>
                <div style={{ fontSize: 12, color: "#5533aa", fontFamily: P.raj, marginBottom: 20 }}>Visit the shop to buy items!</div>
                <button onClick={() => setActiveTab("shop")} style={{ padding: "11px 24px", background: "linear-gradient(135deg,#7B2FFF,#5a1fd4)", border: "none", borderRadius: 8, color: "#fff", fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: P.raj, letterSpacing: "0.5px" }}>Go to Shop →</button>
              </div>
            ) : (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(240px,1fr))", gap: 16 }}>
                {myItems.map((item, i) => (
                  <div key={Number(item.id)} style={{ animation: `slideUp 0.4s ${i * 0.05}s ease both` }}>
                    <ItemCard item={item} owned={true} onBuyArcade={() => { }} onBuyBot={() => { }} buying={false} buyingId={null} tokenName={tokenName} />
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}