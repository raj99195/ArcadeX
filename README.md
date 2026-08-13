<div align="center">

# 🎮 ArcadeX

### The Multi-Chain Web3 Gaming Platform

**Play real games. Earn real on-chain rewards. Build on-chain games in under 2 hours.**

[![Website](https://img.shields.io/badge/Website-playarcadex.in-A020F0?style=for-the-badge)](https://playarcadex.in/)
[![Twitter](https://img.shields.io/badge/Twitter-@PlayArcadeX-1DA1F2?style=for-the-badge&logo=twitter)](https://x.com/PlayArcadeX)
[![Status](https://img.shields.io/badge/Status-Live%20on%20Mainnet-22C55E?style=for-the-badge)](https://playarcadex.in/)
[![Token](https://img.shields.io/badge/Token-%24AX-E1232B?style=for-the-badge)](https://playarcadex.in/)

</div>

---

## 📖 Table of Contents

- [Overview](#-overview)
- [Why ArcadeX](#-why-arcadex)
- [Key Features](#-key-features)
- [Live Deployments](#-live-deployments)
- [Architecture](#-architecture)
- [Tech Stack](#-tech-stack)
- [Smart Contracts](#-smart-contracts)
- [The ArcadeX SDK](#-the-arcadex-sdk)
- [Anti-Cheat & Security](#-anti-cheat--security)
- [The $AX Token](#-the-ax-token)
- [Getting Started](#-getting-started)
- [For Developers](#-for-developers)
- [Project Structure](#-project-structure)
- [Roadmap](#-roadmap)
- [Community & Links](#-community--links)
- [License](#-license)

---

## 🚀 Overview

**ArcadeX** is a live, multi-chain Web3 gaming platform where players play real games and earn real on-chain rewards, and where developers can build and launch their own on-chain games in minutes using our SDK.

Unlike most "Web3 games" — which are just a wallet with a spin button — ArcadeX is a full **gaming ecosystem**: a growing catalog of playable games, on-chain rewards, tamper-proof leaderboards, on-chain tournaments, an in-game marketplace, and a developer SDK that removes all the blockchain complexity from game development.

The platform is **already live on two mainnets**, with **10+ games**, **300+ active players**, and partnerships across multiple chains.

> **The core idea:** make it easy for developers to build on-chain games, and easy for players to play and earn. Everything runs on the **$AX** token.

---

## 💡 Why ArcadeX

Building an on-chain game today is painful. A developer has to:

1. Write and audit smart contracts
2. Deploy them to a chain
3. Integrate them into the game
4. Handle rewards, score verification, wallets, and anti-cheat
5. Repeat all of it for every chain they want to support

This takes **weeks** and requires deep blockchain expertise. Most developers give up.

**ArcadeX solves this.** With our SDK, a developer plugs in a single integration layer and gets a fully on-chain game — rewards, verified scores, anti-cheat, tournaments, and multi-chain support — **live in under 2 hours**. No contract writing. No deployment headaches. No manual integration.

For players, it's just as simple: **every game you play gives you a real on-chain reward**, and creating or joining a tournament takes just a few clicks.

---

## ✨ Key Features

- 🎯 **10+ Live Games** — a growing catalog across multiple genres, all playable in the browser.
- 💰 **On-Chain Rewards** — earn real, verifiable rewards for playing. No fake counters.
- 🏆 **On-Chain Tournaments** — join competitive tournaments with on-chain prize pools in a few clicks.
- 📊 **Tamper-Proof Leaderboards** — leaderboards are read directly from the blockchain, so scores can't be faked.
- 🛒 **In-Game Marketplace** — buy skins, power-ups, and items using $AX.
- 🔗 **Multi-Chain** — one platform, many chains, each with its own native reward token.
- 🧰 **Developer SDK** — build a fully on-chain game in under 2 hours.
- 🛡️ **Anti-Cheat System** — self-learning thresholds, bot protection, and cryptographic score verification.
- 🤖 **AI Game Generation** *(roadmap)* — describe a game in plain words, get a fully SDK-integrated on-chain game.
- 🔒 **Security-Audited** — full internal audit completed with all findings closed.

---

## 🌐 Live Deployments

ArcadeX runs on a multi-chain architecture with a central chain registry, so games and rewards work seamlessly across networks.

| Network | Chain ID | Reward Token | Status |
|---|---|---|---|
| BOTChain | 677 | ARCADE | ✅ Live |
| MST Mainnet | 4646 | MSTC | ✅ Live |
| Additional Chains | — | — | 🔄 In Progress |

Each chain has its own native reward token, and the ArcadeX economy ties them together through the **$AX** platform token.

---

## 🏗️ Architecture

ArcadeX is built around a modular, multi-chain architecture that cleanly separates the game layer, the platform layer, and the on-chain layer.

```
┌─────────────────────────────────────────────────────────────┐
│                        GAME LAYER                            │
│      Unity  ·  Godot  ·  Phaser  ·  HTML5  (via SDK)         │
└──────────────────────────────┬──────────────────────────────┘
                               │  ArcadeX SDK
┌──────────────────────────────▼──────────────────────────────┐
│                      PLATFORM LAYER                          │
│   React/Vite Frontend  ·  Serverless API  ·  Score Signer   │
│   Chain Registry  ·  Anti-Cheat Engine  ·  Session Tokens   │
└──────────────────────────────┬──────────────────────────────┘
                               │  wagmi / viem
┌──────────────────────────────▼──────────────────────────────┐
│                       ON-CHAIN LAYER                         │
│   Platform.sol  ·  Tournament.sol  ·  Leaderboard.sol       │
│   Marketplace  ·  Faucet  ·  Escrow   (per chain)           │
└─────────────────────────────────────────────────────────────┘
```

**Key design principles:**

- **Chain-agnostic** — a central chain registry and React context let the entire app switch chains without code changes.
- **Server-authoritative** — scores are validated server-side and cryptographically signed before they ever touch the chain.
- **Human-readable in, wei out** — the SDK accepts simple values and handles all wei conversion and chain logic internally.
- **Sustainable by design** — daily caps, cooldowns, and minimum-score gates are enforced at the contract level.

---

## 🛠️ Tech Stack

**Frontend**
- React 19 + Vite
- wagmi / viem (wallet + chain interactions)
- Recharts (analytics dashboards)

**Backend / Infrastructure**
- Vercel serverless functions
- Firebase / Firestore
- Node.js score-signing service (ECDSA)

**Smart Contracts**
- Solidity
- Hardhat (compile, test, deploy)
- OpenZeppelin (access control, security primitives)

**Game SDKs**
- Unity (WebGL) — primary SDK
- Godot
- Phaser
- HTML5 / JavaScript

**Networking (PvP titles)**
- Photon Fusion 2
- Socket.IO (authoritative server)

---

## 📜 Smart Contracts

ArcadeX's on-chain layer is a set of purpose-built, security-hardened contracts deployed per chain.

| Contract | Purpose |
|---|---|
| `Platform.sol` | Core rewards logic — reward rates (wei-based), daily earning caps, per-game minimum scores, anti-bot cooldown, emergency pause. |
| `Tournament.sol` | On-chain tournaments with entry, prize pools, ECDSA signature verification, and replay protection. |
| `Leaderboard.sol` | Fully on-chain, tamper-proof leaderboards. |
| `Marketplace` | Skins, power-ups, and in-game item purchases. |
| `Faucet.sol` | Gas faucet with account-gating and one-claim-per-account enforcement. |
| `Escrow.sol` | PvP escrow for wager-based matches. |

**Security features baked in:**

- ✅ ECDSA score verification (scores signed off-chain, verified on-chain)
- ✅ Replay protection on all signed actions
- ✅ Role-based access control (admin gates)
- ✅ Emergency pause
- ✅ Daily earning caps + per-game minimum score gates
- ✅ Anti-bot cooldowns

> Deployed contract addresses per chain are available in the platform's configuration and on the respective block explorers.

---

## 🧰 The ArcadeX SDK

The SDK is the heart of ArcadeX — it's what turns the platform from a single game into a **gaming economy**.

### What you get out of the box

When a developer integrates the ArcadeX SDK, their game instantly gains:

- **On-chain rewards** — reward players in the native token with a single call. The SDK handles wei conversion and chain logic silently.
- **Cryptographic score verification** — every score is signed and verified on-chain (ECDSA + session tokens), so scores can't be spoofed.
- **Built-in anti-cheat** — minimum-score gates, anti-bot cooldowns, and self-learning play-time checks come for free.
- **In-game economy** — ready-made shop, power-up, and skin systems.
- **Multi-chain support** — the same SDK works across every chain ArcadeX supports. Write once, deploy everywhere.
- **Tournaments & leaderboards** — plug straight into the on-chain competitive layer.

### Unity SDK (v4.0.0)

The Unity SDK ships at full feature parity and includes:

- `ArcadeBridge.jslib` — the JS ↔ Unity bridge (init, purchases, rewards, player info)
- `arcade-sdk-unity.js` — platform-side integration with purchase callbacks and auto player-info fetch on init
- `ArcadeManager.cs` — the in-game manager exposing all SDK receivers

**Example — initializing the SDK in Unity:**

```csharp
// In your ArcadeManager, initialization is guaranteed early via Awake()
void Awake()
{
    // GameObject name is guaranteed so the JS bridge can find it
    gameObject.name = "ArcadeManager";
}

void Start()
{
    // Initialize the SDK — the platform auto-fetches player info
    ArcadeSDK.Init(gameId, chainConfig);
}

// Reward the player on-chain after a completed run
public void OnGameOver(int score)
{
    ArcadeSDK.SubmitScore(score);   // signed & verified on-chain automatically
}
```

**Example — a purchase flow:**

```csharp
// Buy a power-up with $AX — the SDK handles the on-chain transaction
ArcadeSDK.PurchasePowerUp("double_points");

// Buy a skin
ArcadeSDK.PurchaseSkin("neon_ball");
```

That's it. No contract calls, no wallet plumbing, no chain-specific code. The developer writes game logic; the SDK handles the blockchain.

---

## 🛡️ Anti-Cheat & Security

Trust is everything in a reward-based platform, so ArcadeX enforces integrity at every layer.

**Anti-cheat**
- Server-side score validation gates before any reward is issued
- Session tokens tied to each play session
- Self-learning per-game thresholds (rolling-average play-time and score-rate limits)
- Soft-ban logic with decay for suspicious accounts
- Negative-score clamping and edge-case guards

**On-chain security**
- ECDSA signature verification on scores and tournament actions
- Replay protection
- Role-based admin access control
- Emergency pause on core contracts

**Platform security**
- Full internal security audit completed — all findings resolved
- Origin validation on serverless endpoints
- Locked-down database rules with a serverless API layer
- Gas estimation with safety buffers for reliable transactions

> ArcadeX deliberately avoids inflating metrics with sybil or fake transactions. Every number reported is real usage.

---

## 🪙 The $AX Token

**$AX** is a **utility token** — the fuel of the entire ArcadeX ecosystem.

| Utility | Description |
|---|---|
| 🏆 Tournaments | Enter tournaments and win from on-chain prize pools |
| 🛒 Marketplace | Buy skins, power-ups, and in-game items |
| 👨‍💻 Creator Payouts | Developers earn and get paid in $AX for the games they publish |
| 🔗 Multi-Chain | Powers rewards and activity across every supported chain |

**Sustainable by design.** Unlike the old play-to-earn models that collapsed under infinite inflation, $AX rewards are protected by:

- Daily earning caps
- Anti-bot cooldowns
- Per-game minimum-score gates
- On-chain score verification

The token's value comes from one thing: **real usage inside a real, live product**.

---

## 🎯 Getting Started

### For Players

1. Visit **[playarcadex.in](https://playarcadex.in/)**
2. Connect your wallet
3. Pick a game from the catalog and start playing
4. Earn on-chain rewards as you play
5. Join tournaments, climb the leaderboard, and spend $AX in the marketplace

No downloads. No installs. Play directly in your browser.

---

## 👨‍💻 For Developers

Want to launch your game on ArcadeX? Here's the high-level flow:

### 1. Get the SDK

Reach out through our channels to get access to the ArcadeX SDK for your engine (Unity, Godot, Phaser, or HTML5).

### 2. Integrate

Drop the SDK into your project and wire up the core hooks:

```csharp
// Unity example
ArcadeSDK.Init(gameId, chainConfig);   // initialize
ArcadeSDK.SubmitScore(score);          // submit a verified score
ArcadeSDK.PurchaseSkin(skinId);        // in-game purchase
```

### 3. Configure rewards

Set your per-game reward rate, minimum score, and cooldown — the platform enforces caps and anti-cheat automatically.

### 4. Publish

Publish your game into the ArcadeX catalog. It goes live with on-chain rewards, verified scores, anti-cheat, tournaments, and multi-chain support — all baked in.

**From integration to live: under 2 hours.**

---

## 📁 Project Structure

```
arcadex/
├── src/
│   ├── components/        # UI components (GamePlay, Leaderboard, Navbar, Creator)
│   ├── context/          # ChainContext, useChain() hook
│   ├── config/           # chains.js — central chain registry
│   ├── pages/            # Home, Games, Tournaments, Marketplace, Admin
│   └── seo/              # Seo.jsx, JSON-LD schemas
├── api/                  # Vercel serverless functions
│   ├── games.js          # game data + validation
│   ├── campaign.js       # campaign portal
│   └── score-signer/     # ECDSA score-signing service
├── contracts/            # Solidity smart contracts
│   ├── Platform.sol
│   ├── Tournament.sol
│   ├── Leaderboard.sol
│   └── ...
├── sdk/                  # Multi-engine SDK
│   ├── unity/            # ArcadeBridge.jslib, ArcadeManager.cs, arcade-sdk-unity.js
│   ├── godot/
│   └── phaser/
├── scripts/              # Deployment scripts (Hardhat)
└── hardhat.config.js
```

---

## 🗺️ Roadmap

### ✅ Shipped
- Multi-chain platform live on 2 mainnets
- 10+ playable games
- On-chain rewards, leaderboards, and tournaments
- Full multi-engine SDK (Unity v4.0.0 at parity)
- Anti-cheat system with self-learning thresholds
- Complete security audit

### 🔄 In Progress
- Mobile-first hyper-casual games
- Additional chain integrations
- More creators onboarding via the SDK
- Expanded marketplace

### 🎯 Flagship — AI Game Generation
- Describe a game in plain language → AI generates a **complete, playable game**
- **Full SDK integration baked in automatically** — on-chain rewards, verified scores, anti-cheat, tournaments, and multi-chain support, with zero manual work
- Idea → live on-chain game in **minutes**

### 🔮 Future
- Full creator marketplace
- Esports-scale tournaments
- Expanded $AX token utility across the entire ecosystem

> **The goal:** become the platform where the next thousand Web3 games are made — and generated.

---

## 🌍 Community & Links

- 🌐 **Website:** [playarcadex.in](https://playarcadex.in/)
- 🐦 **Twitter / X:** [@PlayArcadeX](https://x.com/PlayArcadeX)
- 🎮 **Play now:** [playarcadex.in](https://playarcadex.in/)

Follow us for game drops, tournaments, and ecosystem updates.

---

## 📄 License

Copyright © 2026 ArcadeX. All rights reserved.

*This README describes the ArcadeX platform. For SDK access, partnership, or integration inquiries, reach out through our official channels.*

---

<div align="center">

**Built for players. Built for creators. Built to last.**

🎮 **[Play ArcadeX →](https://playarcadex.in/)**

</div>
