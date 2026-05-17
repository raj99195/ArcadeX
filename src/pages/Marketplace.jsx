import { useState, useEffect } from "react";
import { useAccount, usePublicClient, useWalletClient, useBalance } from "wagmi";

const MARKETPLACE_ADDRESS = import.meta.env.VITE_MARKETPLACE_ADDRESS;
const ARCADE_TOKEN_ADDRESS = import.meta.env.VITE_ARCADE_TOKEN_ADDRESS;

const MARKETPLACE_ABI = [
  { name: "buyArcadeWithBot", type: "function", stateMutability: "payable", inputs: [], outputs: [] },
  { name: "buyItemWithArcade", type: "function", stateMutability: "nonpayable", inputs: [{ name: "itemId", type: "uint256" }], outputs: [] },
  { name: "buyItemWithBot", type: "function", stateMutability: "payable", inputs: [{ name: "itemId", type: "uint256" }], outputs: [] },
  { name: "getArcadeForBot", type: "function", stateMutability: "view", inputs: [{ name: "botAmount", type: "uint256" }], outputs: [{ name: "", type: "uint256" }] },
  { name: "getAllItems", type: "function", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "tuple[]", components: [{ name: "id", type: "uint256" }, { name: "name", type: "string" }, { name: "description", type: "string" }, { name: "imageURI", type: "string" }, { name: "itemType", type: "uint8" }, { name: "arcadePrice", type: "uint256" }, { name: "botPrice", type: "uint256" }, { name: "totalSupply", type: "uint256" }, { name: "sold", type: "uint256" }, { name: "active", type: "bool" }] }] },
  { name: "getUserItems", type: "function", stateMutability: "view", inputs: [{ name: "user", type: "address" }], outputs: [{ name: "", type: "uint256[]" }] },
  { name: "ownsItem", type: "function", stateMutability: "view", inputs: [{ name: "user", type: "address" }, { name: "itemId", type: "uint256" }], outputs: [{ name: "", type: "bool" }] },
  { name: "arcadePerBot", type: "function", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint256" }] },
];

const ERC20_ABI = [
  { name: "approve", type: "function", stateMutability: "nonpayable", inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }], outputs: [{ name: "", type: "bool" }] },
  { name: "balanceOf", type: "function", stateMutability: "view", inputs: [{ name: "account", type: "address" }], outputs: [{ name: "", type: "uint256" }] },
  { name: "allowance", type: "function", stateMutability: "view", inputs: [{ name: "owner", type: "address" }, { name: "spender", type: "address" }], outputs: [{ name: "", type: "uint256" }] },
];

const ITEM_TYPE = ["Badge", "Frame", "Power-Up", "Skin"];
const ITEM_EMOJI = ["🏅", "🖼️", "⚡", "🎨"];
const ITEM_COLOR = ["#FFB700", "#00d4ff", "#00FF88", "#a67fff"];

const P = {
  bg: "#08070f", s1: "#0e0c1a",
  b: "rgba(123,47,255,0.12)", b2: "rgba(123,47,255,0.25)",
  raj: "'Rajdhani',sans-serif", orb: "'Orbitron',sans-serif",
};

function ItemCard({ item, owned, onBuyArcade, onBuyBot, buying, buyingId }) {
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
      {/* Top glow */}
      <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 2, background: `linear-gradient(90deg, transparent, ${color}, transparent)`, opacity: hovered ? 1 : 0.3, transition: "opacity 0.3s" }} />

      {/* Item visual */}
      <div style={{ height: 140, background: `linear-gradient(135deg, rgba(${typeIdx === 0 ? "255,183,0" : typeIdx === 1 ? "0,212,255" : typeIdx === 2 ? "0,255,136" : "123,47,255"},0.1) 0%, rgba(0,0,0,0) 100%)`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 56, position: "relative" }}>
        {ITEM_EMOJI[typeIdx] || "🎮"}
        {owned && (
          <div style={{ position: "absolute", top: 10, right: 10, padding: "4px 10px", borderRadius: 20, background: "rgba(0,255,136,0.15)", border: "1px solid rgba(0,255,136,0.3)", color: "#00FF88", fontSize: 10, fontFamily: P.raj, fontWeight: 700, letterSpacing: "1px" }}>✓ OWNED</div>
        )}
        {soldOut && !owned && (
          <div style={{ position: "absolute", top: 10, right: 10, padding: "4px 10px", borderRadius: 20, background: "rgba(255,68,68,0.15)", border: "1px solid rgba(255,68,68,0.3)", color: "#ff4444", fontSize: 10, fontFamily: P.raj, fontWeight: 700 }}>SOLD OUT</div>
        )}
        <div style={{ position: "absolute", top: 10, left: 10, padding: "3px 9px", borderRadius: 20, background: `${color}22`, border: `1px solid ${color}44`, color, fontSize: 9, fontFamily: P.raj, fontWeight: 700, letterSpacing: "1.5px" }}>
          {ITEM_TYPE[typeIdx]}
        </div>
      </div>

      {/* Content */}
      <div style={{ padding: "14px 16px" }}>
        <div style={{ fontFamily: P.raj, fontWeight: 700, fontSize: 16, color: "#fff", marginBottom: 4 }}>{item.name}</div>
        <div style={{ fontSize: 11, color: "#5533aa", fontFamily: P.raj, marginBottom: 12, lineHeight: 1.5 }}>{item.description}</div>

        {/* Supply bar */}
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

        {/* Price buttons */}
        {!owned && !soldOut && (
          <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
            {arcadePrice > 0 && (
              <button onClick={() => onBuyArcade(item)} disabled={isBuying} style={{
                width: "100%", padding: "10px",
                background: isBuying ? "rgba(123,47,255,0.2)" : "linear-gradient(135deg,#7B2FFF,#5a1fd4)",
                border: "none", borderRadius: 8,
                color: isBuying ? "#5533aa" : "#fff",
                fontSize: 12, fontWeight: 700, cursor: isBuying ? "not-allowed" : "pointer",
                fontFamily: P.raj, letterSpacing: "1px", textTransform: "uppercase",
                transition: "all 0.2s", display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
              }}>
                <span>🎮</span>
                {isBuying ? "Buying..." : `${arcadePrice.toLocaleString()} ARCADE`}
              </button>
            )}
            {botPrice > 0 && (
              <button onClick={() => onBuyBot(item)} disabled={isBuying} style={{
                width: "100%", padding: "10px",
                background: isBuying ? "rgba(0,212,255,0.1)" : "linear-gradient(135deg,rgba(0,212,255,0.2),rgba(0,212,255,0.1))",
                border: "1px solid rgba(0,212,255,0.3)", borderRadius: 8,
                color: isBuying ? "#5533aa" : "#00d4ff",
                fontSize: 12, fontWeight: 700, cursor: isBuying ? "not-allowed" : "pointer",
                fontFamily: P.raj, letterSpacing: "1px", textTransform: "uppercase",
                transition: "all 0.2s", display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
              }}>
                <span>⛓️</span>
                {isBuying ? "Buying..." : `${botPrice} BOT`}
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
  const { data: walletClient } = useWalletClient();
  const { data: botBalance } = useBalance({ address });

  const [items, setItems] = useState([]);
  const [userItems, setUserItems] = useState([]);
  const [arcadeBalance, setArcadeBalance] = useState(0);
  const [arcadePerBot, setArcadePerBot] = useState(1000);
  const [loading, setLoading] = useState(true);
  const [buying, setBuying] = useState(false);
  const [buyingId, setBuyingId] = useState(null);
  const [msg, setMsg] = useState("");
  const [activeTab, setActiveTab] = useState("shop");
  const [activeFilter, setActiveFilter] = useState("all");

  // Buy ARCADE state
  const [botAmount, setBotAmount] = useState("0.1");
  const [swapping, setSwapping] = useState(false);

  const fetchData = async () => {
    if (!publicClient) return;
    setLoading(true);
    try {
      const [allItems, rate] = await Promise.all([
        publicClient.readContract({ address: MARKETPLACE_ADDRESS, abi: MARKETPLACE_ABI, functionName: "getAllItems" }),
        publicClient.readContract({ address: MARKETPLACE_ADDRESS, abi: MARKETPLACE_ABI, functionName: "arcadePerBot" }),
      ]);
      setItems(allItems.filter(i => i.active));
      setArcadePerBot(Number(rate) / 1e18);

      if (address) {
        const [owned, arcade] = await Promise.all([
          publicClient.readContract({ address: MARKETPLACE_ADDRESS, abi: MARKETPLACE_ABI, functionName: "getUserItems", args: [address] }),
          publicClient.readContract({ address: ARCADE_TOKEN_ADDRESS, abi: ERC20_ABI, functionName: "balanceOf", args: [address] }),
        ]);
        setUserItems(owned.map(id => Number(id)));
        setArcadeBalance(Number(arcade) / 1e18);
      }
    } catch (err) { console.error(err); }
    finally { setLoading(false); }
  };

  useEffect(() => { fetchData(); }, [publicClient, address]);

  const handleBuyArcade = async () => {
    if (!walletClient || !botAmount) return;
    setSwapping(true);
    setMsg("");
    try {
      const hash = await walletClient.writeContract({
  address: MARKETPLACE_ADDRESS,
  abi: MARKETPLACE_ABI,
  functionName: "buyArcadeWithBot",
  value: BigInt(Math.floor(Number(botAmount) * 1e18)),
  account: address,
});
      await publicClient.waitForTransactionReceipt({ hash });
      setMsg(`✓ Successfully bought ${(Number(botAmount) * arcadePerBot).toLocaleString()} ARCADE!`);
      await fetchData();
    } catch (err) { setMsg("Error: " + err.message); }
    finally { setSwapping(false); }
  };

  const handleBuyItemWithArcade = async (item) => {
    if (!walletClient) return;
    setBuying(true);
    setBuyingId(Number(item.id));
    setMsg("");
    try {
      // Approve first
      const allowance = await publicClient.readContract({ address: ARCADE_TOKEN_ADDRESS, abi: ERC20_ABI, functionName: "allowance", args: [address, MARKETPLACE_ADDRESS] });
      if (BigInt(allowance) < BigInt(item.arcadePrice)) {
        const approveHash = await walletClient.writeContract({ address: ARCADE_TOKEN_ADDRESS, abi: ERC20_ABI, functionName: "approve", args: [MARKETPLACE_ADDRESS, item.arcadePrice], account: address });
        await publicClient.waitForTransactionReceipt({ hash: approveHash });
      }
      const hash = await walletClient.writeContract({ address: MARKETPLACE_ADDRESS, abi: MARKETPLACE_ABI, functionName: "buyItemWithArcade", args: [BigInt(item.id)], account: address });
      await publicClient.waitForTransactionReceipt({ hash });
      setMsg(`✓ ${item.name} purchased with ARCADE!`);
      await fetchData();
    } catch (err) { setMsg("Error: " + err.message); }
    finally { setBuying(false); setBuyingId(null); }
  };

  const handleBuyItemWithBot = async (item) => {
    if (!walletClient) return;
    setBuying(true);
    setBuyingId(Number(item.id));
    setMsg("");
    try {
      const hash = await walletClient.writeContract({ address: MARKETPLACE_ADDRESS, abi: MARKETPLACE_ABI, functionName: "buyItemWithBot", args: [BigInt(item.id)], value: BigInt(item.botPrice), account: address });
      await publicClient.waitForTransactionReceipt({ hash });
      setMsg(`✓ ${item.name} purchased with BOT!`);
      await fetchData();
    } catch (err) { setMsg("Error: " + err.message); }
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
        .filter-btn:hover { border-color: rgba(123,47,255,0.4) !important; color: #c4a0ff !important; }
        .tab-btn:hover { color: #c4a0ff !important; }
        .swap-input:focus { outline: none; border-color: rgba(0,212,255,0.5) !important; }
      `}</style>

      {/* Particles */}
      <div style={{ position: "fixed", inset: 0, pointerEvents: "none", zIndex: 0 }}>
        {Array.from({ length: 15 }).map((_, i) => (
          <div key={i} style={{ position: "absolute", left: `${Math.random() * 100}%`, top: `${Math.random() * 100}%`, width: Math.random() * 3 + 1, height: Math.random() * 3 + 1, borderRadius: "50%", background: i % 3 === 0 ? "#FFB700" : i % 3 === 1 ? "#7B2FFF" : "#00d4ff", opacity: 0.3, animation: `floatParticle ${Math.random() * 3 + 2}s ${Math.random() * 4}s ease-in-out infinite` }} />
        ))}
        <div style={{ position: "absolute", inset: 0, backgroundImage: "linear-gradient(rgba(123,47,255,0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(123,47,255,0.03) 1px, transparent 1px)", backgroundSize: "50px 50px" }} />
      </div>

      <div style={{ position: "relative", zIndex: 1, padding: "28px 36px" }}>

        {/* Header */}
        <div style={{ marginBottom: 28, animation: "slideUp 0.5s ease forwards" }}>
          <div style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "4px 12px", border: "1px solid rgba(255,183,0,0.25)", borderRadius: 4, fontSize: 9, color: "rgba(255,183,0,0.7)", letterSpacing: "2px", textTransform: "uppercase", marginBottom: 12, background: "rgba(255,183,0,0.06)", fontFamily: P.raj, fontWeight: 600 }}>
            <span style={{ width: 5, height: 5, borderRadius: "50%", background: "#FFB700", animation: "pulse 1.5s ease-in-out infinite" }} />
            ArcadeX Marketplace
          </div>
          <h1 style={{ fontFamily: P.raj, fontWeight: 700, fontSize: 44, letterSpacing: "-0.5px", textTransform: "uppercase", lineHeight: 0.95, color: "#fff", margin: "0 0 8px" }}>
            MARKET<br />
            <span style={{ background: "linear-gradient(90deg,#7B2FFF,#00d4ff,#7B2FFF)", backgroundSize: "200% 100%", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", animation: "gradientShift 3s ease infinite" }}>PLACE</span>
          </h1>
          <p style={{ color: "#5533aa", fontSize: 12, fontFamily: P.raj }}>Buy badges, frames & power-ups with ARCADE or BOT</p>
        </div>

        {/* Balance cards */}
        {isConnected && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 12, marginBottom: 24 }}>
            {[
              { label: "ARCADE Balance", value: arcadeBalance.toLocaleString(), color: "#a67fff", icon: "🎮", sub: "Available to spend" },
              { label: "BOT Balance", value: Number(botBalance?.formatted || 0).toFixed(4), color: "#00d4ff", icon: "⛓️", sub: "Native token" },
              { label: "Items Owned", value: myItems.length, color: "#00FF88", icon: "🏆", sub: "In collection" },
            ].map(s => (
              <div key={s.label} style={{ background: P.s1, border: `1px solid ${P.b}`, borderRadius: 12, padding: "16px 20px", position: "relative", overflow: "hidden" }}>
                <div style={{ position: "absolute", top: -20, right: -20, width: 80, height: 80, background: `radial-gradient(circle,${s.color}15 0%,transparent 70%)`, borderRadius: "50%", pointerEvents: "none" }} />
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                  <span style={{ fontSize: 18 }}>{s.icon}</span>
                  <div style={{ fontSize: 9, color: "#5533aa", fontFamily: P.raj, fontWeight: 700, textTransform: "uppercase", letterSpacing: "1px" }}>{s.label}</div>
                </div>
                <div style={{ fontFamily: P.orb, fontWeight: 700, fontSize: 22, color: s.color, letterSpacing: "-0.5px" }}>{s.value}</div>
                <div style={{ fontSize: 9, color: "#3a2a5a", fontFamily: P.raj, marginTop: 2 }}>{s.sub}</div>
              </div>
            ))}
          </div>
        )}

        {/* Tabs */}
        <div style={{ display: "flex", gap: 0, marginBottom: 24, borderBottom: "1px solid rgba(123,47,255,0.15)" }}>
          {[
            { id: "shop", label: "🛒 Shop" },
            { id: "buy-arcade", label: "💱 Buy ARCADE" },
            { id: "inventory", label: `🎒 My Collection (${myItems.length})` },
          ].map(t => (
            <button key={t.id} className="tab-btn" onClick={() => setActiveTab(t.id)} style={{ padding: "10px 22px", background: "transparent", border: "none", borderBottom: activeTab === t.id ? "2px solid #7B2FFF" : "2px solid transparent", color: activeTab === t.id ? "#c4a0ff" : "#3a2a5a", fontSize: 12, cursor: "pointer", marginBottom: "-1px", fontFamily: P.raj, fontWeight: 700, letterSpacing: "0.5px", textTransform: "uppercase", transition: "color 0.18s" }}>
              {t.label}
            </button>
          ))}
        </div>

        {/* Msg */}
        {msg && (
          <div style={{ marginBottom: 16, padding: "12px 18px", background: msg.startsWith("✓") ? "rgba(0,255,136,0.06)" : "rgba(255,68,68,0.06)", border: `1px solid ${msg.startsWith("✓") ? "rgba(0,255,136,0.2)" : "rgba(255,68,68,0.2)"}`, borderRadius: 10, fontSize: 12, color: msg.startsWith("✓") ? "#00FF88" : "#ff4444", fontFamily: P.raj, fontWeight: 700, display: "flex", justifyContent: "space-between" }}>
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
                { id: "arcade", label: "🎮 ARCADE" },
                { id: "bot", label: "⛓️ BOT" },
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
                    <ItemCard item={item} owned={userItems.includes(Number(item.id))} onBuyArcade={handleBuyItemWithArcade} onBuyBot={handleBuyItemWithBot} buying={buying} buyingId={buyingId} />
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* BUY ARCADE TAB */}
        {activeTab === "buy-arcade" && (
          <div style={{ maxWidth: 480, margin: "0 auto", animation: "slideUp 0.4s ease forwards" }}>

            {/* Exchange rate display */}
            <div style={{ background: "linear-gradient(135deg,rgba(0,212,255,0.1),rgba(123,47,255,0.1))", border: "1px solid rgba(0,212,255,0.2)", borderRadius: 16, padding: 20, marginBottom: 20, textAlign: "center" }}>
              <div style={{ fontSize: 12, color: "#5533aa", fontFamily: P.raj, fontWeight: 700, textTransform: "uppercase", letterSpacing: "1.5px", marginBottom: 12 }}>Exchange Rate</div>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 16 }}>
                <div style={{ textAlign: "center" }}>
                  <div style={{ fontSize: 28, marginBottom: 4, animation: "coinSpin 3s linear infinite" }}>⛓️</div>
                  <div style={{ fontFamily: P.orb, fontWeight: 700, fontSize: 20, color: "#00d4ff" }}>1 BOT</div>
                </div>
                <div style={{ fontSize: 24, color: "#5533aa" }}>→</div>
                <div style={{ textAlign: "center" }}>
                  <div style={{ fontSize: 28, marginBottom: 4 }}>🎮</div>
                  <div style={{ fontFamily: P.orb, fontWeight: 700, fontSize: 20, color: "#a67fff" }}>{arcadePerBot.toLocaleString()} ARCADE</div>
                </div>
              </div>
            </div>

            {/* Swap card */}
            <div style={{ background: P.s1, border: `1px solid ${P.b2}`, borderRadius: 16, padding: 24 }}>
              <div style={{ fontFamily: P.raj, fontWeight: 700, fontSize: 16, color: "#fff", marginBottom: 20 }}>💱 Buy ARCADE with BOT</div>

              {/* Input */}
              <div style={{ marginBottom: 16 }}>
                <label style={{ fontSize: 9, color: "#5533aa", fontFamily: P.raj, fontWeight: 700, textTransform: "uppercase", letterSpacing: "1.2px", display: "block", marginBottom: 6 }}>You Pay (BOT)</label>
                <div style={{ position: "relative" }}>
                  <input className="swap-input" type="number" value={botAmount} onChange={e => setBotAmount(e.target.value)} step="0.01" min="0.01" style={{ width: "100%", padding: "14px 80px 14px 14px", background: "rgba(0,212,255,0.05)", border: "1px solid rgba(0,212,255,0.2)", borderRadius: 10, color: "#00d4ff", fontSize: 18, fontFamily: P.orb, fontWeight: 700, boxSizing: "border-box", transition: "border-color 0.2s" }} />
                  <div style={{ position: "absolute", right: 14, top: "50%", transform: "translateY(-50%)", fontSize: 12, color: "#00d4ff", fontFamily: P.raj, fontWeight: 700 }}>BOT</div>
                </div>
              </div>

              {/* Quick amounts */}
              <div style={{ display: "flex", gap: 6, marginBottom: 16 }}>
                {["0.1", "0.5", "1", "5"].map(amt => (
                  <button key={amt} onClick={() => setBotAmount(amt)} style={{ flex: 1, padding: "6px 0", background: botAmount === amt ? "rgba(0,212,255,0.15)" : "rgba(0,0,0,0.3)", border: `1px solid ${botAmount === amt ? "rgba(0,212,255,0.4)" : "rgba(123,47,255,0.1)"}`, borderRadius: 6, color: botAmount === amt ? "#00d4ff" : "#5533aa", fontSize: 11, cursor: "pointer", fontFamily: P.raj, fontWeight: 700, transition: "all 0.15s" }}>
                    {amt}
                  </button>
                ))}
              </div>

              {/* Output */}
              <div style={{ background: "rgba(0,0,0,0.3)", border: "1px solid rgba(123,47,255,0.1)", borderRadius: 10, padding: "14px", marginBottom: 20 }}>
                <div style={{ fontSize: 9, color: "#5533aa", fontFamily: P.raj, fontWeight: 700, textTransform: "uppercase", letterSpacing: "1.2px", marginBottom: 6 }}>You Receive (ARCADE)</div>
                <div style={{ fontFamily: P.orb, fontWeight: 700, fontSize: 24, color: "#a67fff" }}>{(Number(botAmount) * arcadePerBot).toLocaleString()}</div>
              </div>

              {isConnected ? (
                <button onClick={handleBuyArcade} disabled={swapping || !botAmount} style={{ width: "100%", padding: "14px", background: swapping ? "rgba(123,47,255,0.2)" : "linear-gradient(135deg,#7B2FFF,#5a1fd4)", border: "none", borderRadius: 10, color: swapping ? "#5533aa" : "#fff", fontSize: 13, fontWeight: 700, cursor: swapping ? "not-allowed" : "pointer", fontFamily: P.raj, letterSpacing: "1px", textTransform: "uppercase", transition: "all 0.2s" }}>
                  {swapping ? "Processing..." : `Buy ${(Number(botAmount) * arcadePerBot).toLocaleString()} ARCADE`}
                </button>
              ) : (
                <div style={{ textAlign: "center", padding: 14, background: "rgba(123,47,255,0.06)", border: "1px solid rgba(123,47,255,0.2)", borderRadius: 10, fontSize: 12, color: "#5533aa", fontFamily: P.raj }}>
                  Connect wallet to buy ARCADE
                </div>
              )}
            </div>

            {/* Info */}
            <div style={{ marginTop: 16, padding: 14, background: "rgba(255,183,0,0.05)", border: "1px solid rgba(255,183,0,0.15)", borderRadius: 10 }}>
              <div style={{ fontSize: 10, color: "#FFB700", fontFamily: P.raj, fontWeight: 700, marginBottom: 6 }}>ℹ️ How it works</div>
              <div style={{ fontSize: 11, color: "#7755aa", fontFamily: P.raj, lineHeight: 1.6 }}>
                Send BOT to get ARCADE tokens instantly. ARCADE can be used to join tournaments, buy badges, and more!
              </div>
            </div>
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
                    <ItemCard item={item} owned={true} onBuyArcade={() => { }} onBuyBot={() => { }} buying={false} buyingId={null} />
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