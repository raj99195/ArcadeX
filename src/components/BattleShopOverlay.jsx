// src/components/BattleShopOverlay.jsx
//
// Full-screen shop overlay for Battle Arena. Renders items in a rarity-tinted
// grid, category filter tabs, and a purchase confirmation modal.
//
// ── Backend endpoints (Turn 2 — coming) ────────────────────────────────────
//   GET  /api/games?action=battle-shop-list&chain=<key>   → { items }
//   GET  /api/games?action=battle-shop-inventory          → { items }  (auth'd)
//   POST /api/games?action=battle-shop-purchase-quote     → ECDSA claim payload
//   POST /api/games?action=battle-shop-record-purchase    → mark owned in FS
//
// ── Item shape (Firestore battleShopItems/{itemId}) ────────────────────────
//   {
//     itemId:        "gunSkin_neon",
//     name:          "Neon Blaster",
//     description:   "Cyberpunk-styled energy weapon skin",
//     category:      "gun_skin" | "environment" | "power_up" | "cosmetic",
//     rarity:        "common" | "rare" | "epic" | "legendary",
//     imageUrl:      "https://ipfs.io/ipfs/...",
//     priceARCADE:   50,          // 0 = not sold for ARCADE
//     priceUSDC:     5,           // 0 = not sold for USDC
//     chain:         "mst" | "botchain" | "*" (all chains),
//     active:        true,
//     createdAt:     serverTimestamp
//   }
//
// ── Ownership permanence ───────────────────────────────────────────────────
// Once purchased, an item is permanently unlocked — game reads inventory
// each session and applies the skin/environment/power-up automatically.

import { useState, useEffect, useCallback, memo } from "react";
import { useAccount, useWalletClient } from "wagmi";
import { useChain } from "../context/ChainContext";
import ConfettiBurst from "./ConfettiBurst";
import BattleShop3DViewer from "./BattleShop3DViewer";

// ── Design tokens (matches BattleArena palette) ─────────────────────────────
const S = {
  bg:          "rgba(4,3,10,0.92)",
  panel:       "rgba(12,8,28,0.95)",
  panelSolid:  "#0d0b1a",
  border:      "rgba(139,92,246,0.35)",
  borderHot:   "rgba(0,229,255,0.6)",
  violet:      "#8b5cf6",
  violetL:     "#c4b5fd",
  cyan:        "#00e5ff",
  cyanL:       "#7ff5ff",
  magenta:     "#ec4899",
  green:       "#00ff88",
  gold:        "#ffb700",
  danger:      "#ff3860",
  dim:         "#9977cc",
  dimMore:     "#5533aa",
  raj:         "'Rajdhani', sans-serif",
  orb:         "'Orbitron', sans-serif",
};

const RARITY = {
  common:    { color: "#7c8ca7", glow: "rgba(124,140,167,0.4)", label: "COMMON" },
  rare:      { color: S.cyan,     glow: "rgba(0,229,255,0.5)",   label: "RARE" },
  epic:      { color: S.violet,   glow: "rgba(139,92,246,0.5)",  label: "EPIC" },
  legendary: { color: S.gold,     glow: "rgba(255,183,0,0.6)",   label: "LEGENDARY" },
};

const CATEGORIES = [
  { key: "all",         label: "ALL",          icon: "◈" },
  { key: "gun_skin",    label: "GUN SKINS",    icon: "🔫" },
  { key: "environment", label: "ENVIRONMENTS", icon: "🌌" },
  { key: "power_up",    label: "POWER UPS",    icon: "⚡" },
  { key: "cosmetic",    label: "COSMETICS",    icon: "✨" },
];

const CATEGORY_ICON = {
  gun_skin:    "🔫",
  environment: "🌌",
  power_up:    "⚡",
  cosmetic:    "✨",
};

// ─────────────────────────────────────────────────────────────────────────────
// Item Card
// ─────────────────────────────────────────────────────────────────────────────
const ItemCard = memo(function ItemCard({ item, isOwned, isEquipped, isEquipping, onBuy, onOpen3D, onEquip, onUnequip }) {
  const rarity = RARITY[item.rarity] || RARITY.common;
  const [imgError, setImgError] = useState(false);
  const hasArcade = item.priceARCADE > 0;
  const hasUsdc   = item.priceUSDC > 0;
  const [currency, setCurrency] = useState(hasArcade ? "ARCADE" : "USDC");
  const price = currency === "ARCADE" ? item.priceARCADE : item.priceUSDC;

  return (
    <div
      style={{
        position: "relative",
        background: S.panelSolid,
        border: `2px solid ${rarity.color}`,
        borderRadius: 14,
        overflow: "hidden",
        boxShadow: `0 0 24px ${rarity.glow}, inset 0 0 30px rgba(0,0,0,0.5)`,
        opacity: isOwned ? 0.65 : 1,
        transition: "all 0.3s ease",
        display: "flex", flexDirection: "column",
        animation: "cardEntrance 0.5s ease backwards",
      }}
      onMouseEnter={(e) => {
        if (!isOwned) e.currentTarget.style.transform = "translateY(-4px)";
        e.currentTarget.style.boxShadow =
          `0 8px 40px ${rarity.glow}, inset 0 0 30px rgba(0,0,0,0.5)`;
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.transform = "translateY(0)";
        e.currentTarget.style.boxShadow =
          `0 0 24px ${rarity.glow}, inset 0 0 30px rgba(0,0,0,0.5)`;
      }}
    >
      {/* Rarity badge — top-right */}
      <div
        style={{
          position: "absolute", top: 8, right: 8, zIndex: 3,
          padding: "3px 8px",
          background: rarity.color,
          borderRadius: 4,
          fontFamily: S.orb, fontSize: 9, fontWeight: 800,
          color: "#000", letterSpacing: "1.5px",
        }}
      >
        {rarity.label}
      </div>

      {/* Owned banner — top-left */}
      {isOwned && (
        <div
          style={{
            position: "absolute", top: 8, left: 8, zIndex: 3,
            padding: "3px 10px",
            background: S.green,
            borderRadius: 4,
            fontFamily: S.orb, fontSize: 9, fontWeight: 800,
            color: "#000", letterSpacing: "1.5px",
            boxShadow: `0 0 12px ${S.green}`,
          }}
        >
          ✓ OWNED
        </div>
      )}

      {/* Image */}
      <div
        style={{
          height: 140,
          background:
            `radial-gradient(circle at center, ${rarity.glow} 0%, transparent 70%),` +
            `linear-gradient(135deg, rgba(0,0,0,0.6), rgba(139,92,246,0.1))`,
          display: "flex", alignItems: "center", justifyContent: "center",
          borderBottom: `1px solid ${rarity.color}`,
          overflow: "hidden",
        }}
      >
        {item.imageUrl && !imgError ? (
          <img
            src={item.imageUrl}
            alt={item.name}
            onError={() => setImgError(true)}
            style={{
              maxWidth: "80%", maxHeight: "80%",
              objectFit: "contain",
              filter: `drop-shadow(0 0 20px ${rarity.glow})`,
            }}
          />
        ) : (
          <div style={{ fontSize: 60, filter: `drop-shadow(0 0 20px ${rarity.glow})` }}>
            {CATEGORY_ICON[item.category] || "✨"}
          </div>
        )}
      </div>

      {/* Body */}
      <div style={{ padding: "12px 14px", flex: 1, display: "flex", flexDirection: "column", gap: 8 }}>
        <div>
          <div
            style={{
              fontFamily: S.orb, fontWeight: 700, fontSize: 14,
              color: "#fff", lineHeight: 1.2,
              textShadow: `0 0 8px ${rarity.glow}`,
            }}
          >
            {item.name}
          </div>
          {item.description && (
            <div
              style={{
                fontFamily: S.raj, fontSize: 11,
                color: S.dim, marginTop: 4, lineHeight: 1.3,
                display: "-webkit-box", WebkitLineClamp: 2,
                WebkitBoxOrient: "vertical", overflow: "hidden",
              }}
            >
              {item.description}
            </div>
          )}
        </div>

        <div style={{ marginTop: "auto", display: "flex", flexDirection: "column", gap: 8 }}>
          {/* Currency selector (only if both prices set) */}
          {hasArcade && hasUsdc && !isOwned && (
            <div style={{ display: "flex", gap: 4 }}>
              {["ARCADE", "USDC"].map(c => (
                <button
                  key={c}
                  onClick={() => setCurrency(c)}
                  style={{
                    flex: 1,
                    padding: "5px",
                    background: currency === c ? `${rarity.color}22` : "rgba(0,0,0,0.4)",
                    border: `1px solid ${currency === c ? rarity.color : S.border}`,
                    borderRadius: 5,
                    color: currency === c ? rarity.color : S.dim,
                    fontFamily: S.raj, fontSize: 10, fontWeight: 700,
                    cursor: "pointer", letterSpacing: "1px",
                  }}
                >
                  {c}
                </button>
              ))}
            </div>
          )}

          {/* Open 3D Preview button — shown only if item has a modelUrl */}
          {item.modelUrl && (
            <button
              onClick={() => onOpen3D(item)}
              style={{
                padding: "8px",
                background: "rgba(0,0,0,0.5)",
                border: `1px solid ${rarity.color}`,
                borderRadius: 6,
                color: rarity.color,
                fontFamily: S.orb, fontWeight: 700, fontSize: 10,
                cursor: "pointer",
                letterSpacing: "1.5px",
                textTransform: "uppercase",
                display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
                transition: "all 0.2s ease",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = `${rarity.color}22`;
                e.currentTarget.style.boxShadow = `0 0 12px ${rarity.glow}`;
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = "rgba(0,0,0,0.5)";
                e.currentTarget.style.boxShadow = "none";
              }}
            >
              ◈ 3D Preview
            </button>
          )}

          {/* Price + Buy / Equip / Equipped button */}
          {isOwned ? (
            isEquipped ? (
              <button
                onClick={() => onUnequip?.(item)}
                disabled={isEquipping}
                style={{
                  padding: "10px",
                  background: `linear-gradient(135deg, ${S.gold}, #ff8800)`,
                  border: "none", borderRadius: 6,
                  color: "#000",
                  fontFamily: S.orb, fontWeight: 800, fontSize: 12,
                  cursor: isEquipping ? "wait" : "pointer",
                  letterSpacing: "2px", textTransform: "uppercase",
                  boxShadow: `0 0 18px ${S.gold}, inset 0 0 12px rgba(255,255,255,0.15)`,
                  opacity: isEquipping ? 0.7 : 1,
                  transition: "all 0.15s ease",
                }}
              >
                {isEquipping ? "…" : "✓ EQUIPPED"}
              </button>
            ) : (
              <button
                onClick={() => onEquip?.(item)}
                disabled={isEquipping}
                style={{
                  padding: "10px",
                  background: "rgba(0,255,136,0.08)",
                  border: `1px solid ${S.green}`, borderRadius: 6,
                  color: S.green,
                  fontFamily: S.orb, fontWeight: 800, fontSize: 12,
                  cursor: isEquipping ? "wait" : "pointer",
                  letterSpacing: "2px", textTransform: "uppercase",
                  transition: "all 0.15s ease",
                  opacity: isEquipping ? 0.7 : 1,
                }}
                onMouseEnter={(e) => {
                  if (!isEquipping) {
                    e.currentTarget.style.background = "rgba(0,255,136,0.15)";
                    e.currentTarget.style.boxShadow = `0 0 12px ${S.green}`;
                  }
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = "rgba(0,255,136,0.08)";
                  e.currentTarget.style.boxShadow = "none";
                }}
              >
                {isEquipping ? "…" : "◈ EQUIP"}
              </button>
            )
          ) : (
            <button
              onClick={() => onBuy(item, currency, price)}
              style={{
                padding: "10px",
                background: `linear-gradient(135deg, ${rarity.color}, ${S.violet})`,
                border: "none",
                borderRadius: 6,
                color: "#000",
                fontFamily: S.orb, fontWeight: 800, fontSize: 12,
                cursor: "pointer",
                letterSpacing: "1.5px",
                textTransform: "uppercase",
                boxShadow: `0 0 16px ${rarity.glow}`,
                transition: "all 0.2s ease",
              }}
              onMouseEnter={(e) => e.currentTarget.style.filter = "brightness(1.15)"}
              onMouseLeave={(e) => e.currentTarget.style.filter = "brightness(1)"}
            >
              {price} {currency} · BUY
            </button>
          )}
        </div>
      </div>
    </div>
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// Purchase confirmation modal
// ─────────────────────────────────────────────────────────────────────────────
function PurchaseModal({ item, currency, price, stage, error, onConfirm, onCancel }) {
  const rarity = RARITY[item.rarity] || RARITY.common;
  const isProcessing = stage && stage !== "success" && stage !== "failed";
  const stageLabels = {
    approving:  "Approving token...",
    purchasing: "Confirm in wallet",
    confirming: "Confirming on-chain...",
    recording:  "Finalizing...",
  };

  return (
    <div
      style={{
        position: "fixed", inset: 0, zIndex: 10001,
        background: "rgba(0,0,0,0.85)",
        backdropFilter: "blur(10px)",
        display: "flex", alignItems: "center", justifyContent: "center",
        padding: 20,
        animation: "fadeIn 0.2s ease",
      }}
      onClick={isProcessing ? null : onCancel}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          maxWidth: 400, width: "100%",
          background: S.panel,
          border: `2px solid ${rarity.color}`,
          borderRadius: 14,
          padding: "24px",
          boxShadow: `0 0 60px ${rarity.glow}`,
          animation: "overlaySlideUp 0.3s ease",
        }}
      >
        {stage === "success" ? (
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 60, marginBottom: 12 }}>🎉</div>
            <div
              style={{
                fontFamily: S.orb, fontWeight: 700, fontSize: 16,
                color: S.green, letterSpacing: "3px", marginBottom: 8,
                textShadow: `0 0 15px ${S.green}`,
              }}
            >
              UNLOCKED
            </div>
            <div style={{ fontFamily: S.raj, fontSize: 13, color: S.violetL, marginBottom: 20 }}>
              {item.name} is now yours
            </div>
            <button
              onClick={onCancel}
              style={{
                padding: "10px 30px",
                background: S.green, border: "none", borderRadius: 6,
                fontFamily: S.orb, fontWeight: 800, fontSize: 12,
                color: "#000", cursor: "pointer", letterSpacing: "2px",
              }}
            >
              CONTINUE
            </button>
          </div>
        ) : stage === "failed" ? (
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 50, marginBottom: 10 }}>⚠</div>
            <div
              style={{
                fontFamily: S.orb, fontWeight: 700, fontSize: 14,
                color: S.danger, marginBottom: 8,
              }}
            >
              PURCHASE FAILED
            </div>
            <div style={{ fontFamily: S.raj, fontSize: 12, color: S.dim, marginBottom: 20 }}>
              {error || "Something went wrong"}
            </div>
            <button
              onClick={onCancel}
              style={{
                padding: "10px 30px",
                background: "rgba(255,56,96,0.15)",
                border: `1px solid ${S.danger}`, borderRadius: 6,
                fontFamily: S.orb, fontWeight: 700, fontSize: 12,
                color: S.danger, cursor: "pointer", letterSpacing: "2px",
              }}
            >
              CLOSE
            </button>
          </div>
        ) : isProcessing ? (
          <div style={{ textAlign: "center" }}>
            <div
              style={{
                width: 60, height: 60, margin: "0 auto 20px",
                border: `4px solid rgba(0,229,255,0.2)`,
                borderTop: `4px solid ${S.cyan}`,
                borderRadius: "50%",
                animation: "spinnerRing 1s linear infinite",
              }}
            />
            <div
              style={{
                fontFamily: S.orb, fontWeight: 700, fontSize: 13,
                color: S.cyanL, letterSpacing: "2px",
                textShadow: `0 0 10px ${S.cyan}`,
              }}
            >
              {stageLabels[stage] || stage}
            </div>
            {stage === "purchasing" && (
              <div style={{ fontFamily: S.raj, fontSize: 11, color: S.dim, marginTop: 6 }}>
                Keep this tab open
              </div>
            )}
          </div>
        ) : (
          <>
            <div
              style={{
                fontFamily: S.orb, fontWeight: 700, fontSize: 16,
                color: "#fff", letterSpacing: "2px", marginBottom: 16,
                textAlign: "center",
                textShadow: `0 0 10px ${rarity.glow}`,
              }}
            >
              CONFIRM PURCHASE
            </div>
            <div
              style={{
                padding: "14px",
                background: "rgba(0,0,0,0.4)",
                borderRadius: 8,
                border: `1px solid ${S.border}`,
                marginBottom: 20,
              }}
            >
              <div
                style={{
                  fontFamily: S.raj, fontSize: 11, color: S.dim,
                  marginBottom: 4, textTransform: "uppercase", letterSpacing: "2px",
                }}
              >
                ITEM
              </div>
              <div
                style={{
                  fontFamily: S.orb, fontWeight: 700, fontSize: 16,
                  color: rarity.color, marginBottom: 12,
                }}
              >
                {item.name}
              </div>
              <div
                style={{
                  fontFamily: S.raj, fontSize: 11, color: S.dim,
                  marginBottom: 4, textTransform: "uppercase", letterSpacing: "2px",
                }}
              >
                PRICE
              </div>
              <div
                style={{
                  fontFamily: S.orb, fontWeight: 800, fontSize: 22,
                  color: S.gold, textShadow: `0 0 10px ${S.gold}`,
                }}
              >
                {price} {currency}
              </div>
            </div>
            <div style={{ display: "flex", gap: 10 }}>
              <button
                onClick={onCancel}
                style={{
                  flex: 1, padding: "12px",
                  background: "rgba(0,0,0,0.5)",
                  border: `1px solid ${S.border}`, borderRadius: 6,
                  color: S.violetL, cursor: "pointer",
                  fontFamily: S.orb, fontWeight: 700, fontSize: 12,
                  letterSpacing: "2px",
                }}
              >
                CANCEL
              </button>
              <button
                onClick={onConfirm}
                style={{
                  flex: 2, padding: "12px",
                  background: `linear-gradient(135deg, ${rarity.color}, ${S.violet})`,
                  border: "none", borderRadius: 6,
                  color: "#000", cursor: "pointer",
                  fontFamily: S.orb, fontWeight: 800, fontSize: 12,
                  letterSpacing: "2px",
                  boxShadow: `0 0 20px ${rarity.glow}`,
                }}
              >
                CONFIRM
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main overlay
// ─────────────────────────────────────────────────────────────────────────────
export default function BattleShopOverlay({ open, onClose, onItemUnlocked, onEquippedChanged }) {
  const { chainKey } = useChain();
  const { address } = useAccount();
  const { data: walletClient } = useWalletClient();
  const [isMobile, setIsMobile] = useState(window.innerWidth <= 768);
  const [category, setCategory] = useState("all");
  const [items, setItems] = useState([]);
  const [inventory, setInventory] = useState([]);   // owned itemIds
  const [equipped, setEquipped]   = useState([]);   // currently equipped (skins + powerups combined)
  const [equipping, setEquipping] = useState(null); // itemId currently in equip flight
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // Purchase modal state
  const [modalItem, setModalItem] = useState(null);
  const [modalCurrency, setModalCurrency] = useState(null);
  const [modalPrice, setModalPrice] = useState(0);
  const [purchaseStage, setPurchaseStage] = useState(null);
  const [purchaseError, setPurchaseError] = useState(null);

  // ── 3D viewer state ──
  const [viewer3DItem, setViewer3DItem] = useState(null);

  useEffect(() => {
    const h = () => setIsMobile(window.innerWidth <= 768);
    window.addEventListener("resize", h);
    return () => window.removeEventListener("resize", h);
  }, []);

  // Lock body scroll while open
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  // Escape to close
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === "Escape" && !purchaseStage) onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, purchaseStage, onClose]);

  // Fetch items + inventory when overlay opens
  useEffect(() => {
    if (!open || !chainKey) return;
    let cancelled = false;

    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        // Items list (public — no auth needed)
        const itemsRes = await fetch(`/api/games?action=battle-shop-list&chain=${chainKey}`);
        // Backend may not be deployed yet — silently show empty state if 404/400
        if (itemsRes.status === 404 || itemsRes.status === 400) {
          if (!cancelled) setItems([]);
        } else {
          const itemsData = await itemsRes.json();
          if (cancelled) return;
          if (!itemsRes.ok) throw new Error(itemsData.error || "Failed to load items");
          setItems(itemsData.items || []);
        }

        // Inventory + equipped (auth'd)
        if (address) {
          const token = localStorage.getItem("arcadex_jwt");
          if (token) {
            const invRes = await fetch(`/api/games?action=battle-shop-inventory`, {
              headers: { Authorization: `Bearer ${token}` },
            });
            if (invRes.ok) {
              const invData = await invRes.json();
              if (!cancelled) {
                setInventory((invData.items || []).map(x => x.itemId));
                const active = [
                  ...Object.values(invData.equipped || {}),
                  ...(invData.powerUps || []),
                ].filter(Boolean);
                setEquipped(active);
                if (typeof onEquippedChanged === "function") onEquippedChanged(active);
              }
            }
          }
        }
      } catch (err) {
        if (!cancelled) setError(err.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    load();
    return () => { cancelled = true; };
  }, [open, chainKey, address]);

  const handleBuy = useCallback((item, currency, price) => {
    setModalItem(item);
    setModalCurrency(currency);
    setModalPrice(price);
    setPurchaseStage(null);
    setPurchaseError(null);
  }, []);

  const handleConfirmPurchase = useCallback(async () => {
    if (!modalItem || !modalCurrency || !address || !walletClient) return;
    setPurchaseError(null);

    try {
      // ═══ Step 1: Get signed quote from backend ═══════════════════════
      setPurchaseStage("quote");
      const token = localStorage.getItem("arcadex_jwt");
      if (!token) throw new Error("Please connect wallet + sign in first");

      const quoteRes = await fetch("/api/games?action=battle-shop-purchase-quote", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          itemId:   modalItem.itemId,
          chain:    chainKey,
          currency: modalCurrency,
        }),
      });
      const quote = await quoteRes.json();
      if (!quoteRes.ok) throw new Error(quote.error || "Quote failed");

      const {
        itemIdBytes32, token: tokenAddr, price, nonce,
        signature, contract: shopAddr, chainId,
      } = quote;
      const priceBig = BigInt(price);

      // JSON-format ABIs (wagmi/viem requires object shape, not human-readable strings)
      const ERC20_ABI = [
        {
          name: "allowance", type: "function", stateMutability: "view",
          inputs:  [
            { name: "owner",   type: "address" },
            { name: "spender", type: "address" },
          ],
          outputs: [{ name: "", type: "uint256" }],
        },
        {
          name: "approve", type: "function", stateMutability: "nonpayable",
          inputs:  [
            { name: "spender", type: "address" },
            { name: "amount",  type: "uint256" },
          ],
          outputs: [{ name: "", type: "bool" }],
        },
      ];
      const SHOP_ABI = [
        {
          name: "purchase", type: "function", stateMutability: "nonpayable",
          inputs: [
            { name: "itemId",    type: "bytes32" },
            { name: "token",     type: "address" },
            { name: "price",     type: "uint256" },
            { name: "nonce",     type: "bytes32" },
            { name: "signature", type: "bytes"   },
          ],
          outputs: [],
        },
      ];

      const { readContract, writeContract, waitForTransactionReceipt } =
        await import("@wagmi/core");
      const { wagmiAdapter } = await import("../Providers");

      // ═══ Step 2: Check current allowance + approve if needed ═════════
      setPurchaseStage("approve");
      const currentAllowance = await readContract(wagmiAdapter.wagmiConfig, {
        address:      tokenAddr,
        abi:          ERC20_ABI,
        functionName: "allowance",
        args:         [address, shopAddr],
        chainId:      Number(chainId),
      });

      if (BigInt(currentAllowance) < priceBig) {
        const approveHash = await writeContract(wagmiAdapter.wagmiConfig, {
          address:      tokenAddr,
          abi:          ERC20_ABI,
          functionName: "approve",
          args:         [shopAddr, priceBig],
          chainId:      Number(chainId),
        });
        await waitForTransactionReceipt(wagmiAdapter.wagmiConfig, {
          hash: approveHash, chainId: Number(chainId),
        });
      }

      // ═══ Step 3: Call BattleShop.purchase() ══════════════════════════
      setPurchaseStage("purchase");
      const purchaseHash = await writeContract(wagmiAdapter.wagmiConfig, {
        address:      shopAddr,
        abi:          SHOP_ABI,
        functionName: "purchase",
        args:         [itemIdBytes32, tokenAddr, priceBig, nonce, signature],
        chainId:      Number(chainId),
      });

      setPurchaseStage("confirming");
      await waitForTransactionReceipt(wagmiAdapter.wagmiConfig, {
        hash: purchaseHash, chainId: Number(chainId),
      });

      // ═══ Step 4: Tell backend to mirror on-chain ownership ═══════════
      setPurchaseStage("recording");
      const recRes = await fetch("/api/games?action=battle-shop-record-purchase", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          itemId: modalItem.itemId,
          chain:  chainKey,
          nonce,
          txHash: purchaseHash,
        }),
      });
      const recData = await recRes.json();
      if (!recRes.ok) throw new Error(recData.error || "Record failed");

      // ═══ Step 5: Success — update local state + notify parent ════════
      setPurchaseStage("success");
      setInventory(prev => prev.includes(modalItem.itemId) ? prev : [...prev, modalItem.itemId]);
      // Backend auto-equipped it if slot was empty — refresh equipped map
      if (recData.equipped || recData.powerUps) {
        const active = [
          ...Object.values(recData.equipped || {}),
          ...(recData.powerUps || []),
        ].filter(Boolean);
        setEquipped(active);
        if (typeof onEquippedChanged === "function") onEquippedChanged(active);
      }
      if (typeof onItemUnlocked === "function") {
        onItemUnlocked({
          itemId:   modalItem.itemId,
          category: modalItem.category,
          name:     modalItem.name,
        });
      }
    } catch (err) {
      console.error("[purchase]", err);
      const raw = err?.shortMessage || err?.message || "Purchase failed";
      const friendly = /user rejected|user denied/i.test(raw)
        ? "Transaction cancelled"
        : /insufficient/i.test(raw)
          ? "Insufficient balance"
          : raw.length > 140 ? raw.slice(0, 140) + "…" : raw;
      setPurchaseError(friendly);
      setPurchaseStage("failed");
    }
  }, [modalItem, modalCurrency, modalPrice, address, walletClient, chainKey, onItemUnlocked, onEquippedChanged]);

  // ── Equip / unequip flow ──
  // Backend has all the slot / power-up logic; we just call, get back the
  // updated state, and push it up to the parent so it can forward to Unity
  // via the SDK's BATTLE_EQUIPPED message.
  const equipItem = useCallback(async (item) => {
    if (!address || equipping) return;
    setEquipping(item.itemId);
    try {
      const token = localStorage.getItem("arcadex_jwt");
      const res = await fetch("/api/games?action=battle-shop-equip", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ itemId: item.itemId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Equip failed");
      const active = [
        ...Object.values(data.equipped || {}),
        ...(data.powerUps || []),
      ].filter(Boolean);
      setEquipped(active);
      if (typeof onEquippedChanged === "function") onEquippedChanged(active);
    } catch (err) {
      console.error("[equip]", err);
      setError(err.message);
      setTimeout(() => setError(null), 3000);
    } finally {
      setEquipping(null);
    }
  }, [address, equipping, onEquippedChanged]);

  const unequipItem = useCallback(async (item) => {
    if (!address || equipping) return;
    setEquipping(item.itemId);
    try {
      const token = localStorage.getItem("arcadex_jwt");
      const res = await fetch("/api/games?action=battle-shop-unequip", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ itemId: item.itemId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Unequip failed");
      const active = [
        ...Object.values(data.equipped || {}),
        ...(data.powerUps || []),
      ].filter(Boolean);
      setEquipped(active);
      if (typeof onEquippedChanged === "function") onEquippedChanged(active);
    } catch (err) {
      console.error("[unequip]", err);
      setError(err.message);
      setTimeout(() => setError(null), 3000);
    } finally {
      setEquipping(null);
    }
  }, [address, equipping, onEquippedChanged]);

  const handleCloseModal = useCallback(() => {
    setModalItem(null);
    setModalCurrency(null);
    setModalPrice(0);
    setPurchaseStage(null);
    setPurchaseError(null);
  }, []);

  const filteredItems = category === "all"
    ? items
    : items.filter(i => i.category === category);

  if (!open) return null;

  return (
    <div
      style={{
        position: "fixed", inset: 0, zIndex: 9998,
        background: S.bg,
        backdropFilter: "blur(12px)",
        display: "flex", alignItems: "center", justifyContent: "center",
        padding: isMobile ? 0 : 30,
        animation: "fadeIn 0.3s ease",
      }}
      // Backdrop click closes shop — BUT not when 3D viewer is open on top
      // (otherwise clicking outside the model in viewer would dismiss the
      // whole shop, unmount the viewer, and confuse the user).
      onClick={viewer3DItem ? undefined : onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          maxWidth: 1200, width: "100%",
          maxHeight: isMobile ? "100vh" : "90vh",
          background: S.panel,
          border: `2px solid ${S.borderHot}`,
          borderRadius: isMobile ? 0 : 18,
          overflow: "hidden",
          boxShadow: `0 0 80px rgba(0,229,255,0.4), 0 0 200px rgba(139,92,246,0.2)`,
          display: "flex", flexDirection: "column",
          animation: "overlaySlideUp 0.4s ease",
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: isMobile ? "16px" : "20px 28px",
            borderBottom: `1px solid ${S.border}`,
            display: "flex", alignItems: "center", gap: 16,
            background: "linear-gradient(180deg, rgba(139,92,246,0.15), rgba(0,229,255,0.05))",
          }}
        >
          <div style={{ flex: 1 }}>
            <div
              style={{
                fontFamily: S.orb, fontWeight: 900, fontSize: isMobile ? 20 : 28,
                color: "#fff", letterSpacing: isMobile ? "4px" : "8px",
                textShadow: `0 0 20px ${S.violet}, 0 0 40px ${S.cyan}`,
                lineHeight: 1,
              }}
            >
              ⚗ SHOP ⚗
            </div>
            {!isMobile && (
              <div
                style={{
                  fontFamily: S.raj, fontSize: 11,
                  color: S.cyan, letterSpacing: "3px", marginTop: 6,
                  textShadow: `0 0 8px ${S.cyan}`,
                }}
              >
                ▸ UNLOCK PERMANENT UPGRADES ◂
              </div>
            )}
          </div>
          <button
            onClick={onClose}
            style={{
              width: 40, height: 40,
              background: "rgba(0,0,0,0.6)",
              border: `1px solid ${S.borderHot}`, borderRadius: 8,
              color: S.cyanL, fontSize: 18, cursor: "pointer",
              display: "flex", alignItems: "center", justifyContent: "center",
              boxShadow: `0 0 15px rgba(0,229,255,0.3)`,
            }}
          >
            ✕
          </button>
        </div>

        {/* Category tabs */}
        <div
          style={{
            padding: "12px 16px",
            borderBottom: `1px solid ${S.border}`,
            display: "flex", gap: 6, overflowX: "auto",
            background: "rgba(0,0,0,0.3)",
          }}
        >
          {CATEGORIES.map(c => (
            <button
              key={c.key}
              onClick={() => setCategory(c.key)}
              style={{
                padding: "8px 14px",
                background: category === c.key
                  ? `linear-gradient(135deg, ${S.violet}, ${S.cyan})`
                  : "rgba(0,0,0,0.4)",
                border: `1px solid ${category === c.key ? S.cyan : S.border}`,
                borderRadius: 6,
                color: category === c.key ? "#000" : S.violetL,
                fontFamily: S.orb, fontWeight: 700, fontSize: 11,
                letterSpacing: "1.5px", cursor: "pointer",
                whiteSpace: "nowrap",
                boxShadow: category === c.key ? `0 0 15px ${S.cyanL}` : "none",
                flexShrink: 0,
              }}
            >
              {c.icon} {c.label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div style={{ flex: 1, overflowY: "auto", padding: isMobile ? "16px" : "24px 28px" }}>
          {loading ? (
            <div style={{ textAlign: "center", padding: "60px 0" }}>
              <div
                style={{
                  width: 50, height: 50, margin: "0 auto 16px",
                  border: `4px solid rgba(139,92,246,0.2)`,
                  borderTop: `4px solid ${S.violet}`,
                  borderRadius: "50%",
                  animation: "spinnerRing 1s linear infinite",
                }}
              />
              <div
                style={{
                  fontFamily: S.raj, fontSize: 13, color: S.violetL,
                  letterSpacing: "2px",
                }}
              >
                Loading inventory...
              </div>
            </div>
          ) : error ? (
            <div
              style={{
                textAlign: "center", padding: "60px 20px",
                color: S.danger, fontFamily: S.raj, fontSize: 13,
              }}
            >
              ⚠ {error}
            </div>
          ) : filteredItems.length === 0 ? (
            <div style={{ textAlign: "center", padding: "80px 20px" }}>
              <div style={{ fontSize: 60, marginBottom: 16, filter: `drop-shadow(0 0 20px ${S.violet})` }}>⚗</div>
              <div
                style={{
                  fontFamily: S.orb, fontSize: 16, color: S.violetL,
                  letterSpacing: "3px", marginBottom: 8,
                  textShadow: `0 0 10px ${S.violet}`,
                }}
              >
                SHOP LOADING SOON
              </div>
              <div
                style={{
                  fontFamily: S.raj, fontSize: 12, color: S.dim,
                  maxWidth: 340, margin: "0 auto",
                }}
              >
                Admin is stocking the shop. Check back shortly to unlock skins, environments and power-ups.
              </div>
            </div>
          ) : (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: isMobile
                  ? "repeat(2,1fr)"
                  : "repeat(auto-fill, minmax(230px, 1fr))",
                gap: 14,
              }}
            >
              {filteredItems.map(item => (
                <ItemCard
                  key={item.itemId}
                  item={item}
                  isOwned={inventory.includes(item.itemId)}
                  isEquipped={equipped.includes(item.itemId)}
                  isEquipping={equipping === item.itemId}
                  onBuy={handleBuy}
                  onOpen3D={(it) => setViewer3DItem(it)}
                  onEquip={equipItem}
                  onUnequip={unequipItem}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Purchase modal */}
      {modalItem && (
        <PurchaseModal
          item={modalItem}
          currency={modalCurrency}
          price={modalPrice}
          stage={purchaseStage}
          error={purchaseError}
          onConfirm={handleConfirmPurchase}
          onCancel={handleCloseModal}
        />
      )}

      {/* 3D Model Viewer — opens on card "3D Preview" button click */}
      {viewer3DItem && (
        <BattleShop3DViewer
          open={!!viewer3DItem}
          item={viewer3DItem}
          isOwned={inventory.includes(viewer3DItem.itemId)}
          onBuy={(it, cur, prc) => {
            // Trigger the same purchase flow as the item card. Purchase
            // modal renders above the 3D viewer (higher z-index).
            handleBuy(it, cur, prc);
          }}
          onClose={() => setViewer3DItem(null)}
        />
      )}

      {/* Rarity-colored confetti on successful purchase */}
      {purchaseStage === "success" && modalItem && (() => {
        const rarity = RARITY[modalItem.rarity] || RARITY.common;
        // Rarity-tinted palette: strong core color + supporting whites/accents
        const paletteByRarity = {
          common:    ["#7c8ca7", "#c0c8d5", "#ffffff", "#a6b2c4"],
          rare:      [S.cyan, S.cyanL, S.violet, "#ffffff"],
          epic:      [S.violet, S.violetL, S.magenta, "#ffffff"],
          legendary: [S.gold, "#ff8800", S.violet, S.cyan, "#ffffff"],
        };
        const colors = paletteByRarity[modalItem.rarity] || paletteByRarity.common;
        return (
          <ConfettiBurst
            colors={colors}
            count={modalItem.rarity === "legendary" ? 240 : 170}
            duration={3500}
          />
        );
      })()}

      <style>{`
        @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
        @keyframes overlaySlideUp {
          from { opacity: 0; transform: translateY(30px) scale(0.96); }
          to   { opacity: 1; transform: translateY(0) scale(1); }
        }
        @keyframes cardEntrance {
          from { opacity: 0; transform: translateY(20px) scale(0.9); }
          to   { opacity: 1; transform: translateY(0) scale(1); }
        }
        @keyframes spinnerRing { to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}