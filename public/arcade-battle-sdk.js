/**
 * ArcadeX Battle Arena SDK v1.1.0 — Unity WebGL Edition
 *
 * Place this file in your Unity WebGLTemplate folder so it's copied to the
 * build root on every build, or directly in the WebGL Build folder next to
 * index.html.
 *
 * ── C# ↔ JS BRIDGE ──
 * BattleBridge.jslib (Assets/Plugins/WebGL/) calls ArcadeBattleSDK.* methods.
 * Platform → game callbacks are delivered to a GameObject named exactly
 * "BattleManager" via Unity's SendMessage:
 *   OnPlayerInfoReceived(string json)     // { address, chainName, chainId }
 *   OnInventoryReceived(string json)      // { items: ["gunSkin_neon", ...] }
 *   OnItemUnlocked(string json)           // { itemId, category, name }
 *   OnClaimStarted()                       // no args
 *   OnClaimSuccess(string json)            // { txHash, arcadeAmount, explorerUrl }
 *   OnClaimFailed(string json)             // { error }
 *
 * ── FLOW ──
 *   1. Game boots → ArcadeBattleSDK.init() → platform sends PLAYER_INFO + INVENTORY
 *   2. Game applies inventory (unlock skins/environments/power-ups)
 *   3. Round starts → ArcadeBattleSDK.roundStart(1)
 *   4. Round ends → ArcadeBattleSDK.roundEnd(1, 15)  // $15 earned in round 1
 *   5. Repeat for rounds 2-5
 *   6. All 5 rounds done → ArcadeBattleSDK.gameComplete()
 *   7. Player clicks Claim on platform sidebar → CLAIM_STARTED → tx →
 *      CLAIM_SUCCESS or CLAIM_FAILED → SendMessage to Unity
 *
 *   In-game shop button:
 *   • ArcadeBattleSDK.openShop() → opens platform's shop overlay
 *   • Player purchases item → BATTLE_ITEM_UNLOCKED + fresh BATTLE_INVENTORY
 *     arrive → game applies new item live
 *
 * ── SECURITY ──
 * Every postMessage carries `_arcadex_battle: true` — platform side matches
 * origin AND this marker before processing. The session token from init()
 * is auto-attached to every round message so random iframes can't spoof.
 *
 * ── CHANGELOG ──
 *   v1.1.0 — Shop / inventory sync
 *     • openShop()          — game can trigger platform's shop overlay
 *     • getInventory()      — game can request an inventory resend
 *     • BATTLE_INVENTORY    — full owned itemIds list (on init + after unlock)
 *     • BATTLE_ITEM_UNLOCKED — single-item unlock notification (animation trigger)
 *     • OnInventoryReceived / OnItemUnlocked SendMessage callbacks
 *   v1.0.0 — Initial release
 */

(function (global) {
  "use strict";

  var ArcadeBattleSDK = {
    version: "1.1.0",
    initialized: false,
    debug: false,

    // ─── Internal state ─────────────────────────────────────────────
    _sessionToken:     null,   // set by platform after init
    _currentRound:     0,       // 0 = not started, 1-5 = active
    _completedRounds:  {},      // { 1: true, 2: true, ... } — guard duplicates
    _gameCompleted:    false,   // one-way flag once gameComplete() fires
    _inventory:        [],      // last-known owned itemIds (for getInventory sync)

    // ─── INIT ────────────────────────────────────────────────────────
    /**
     * Call once when the game boots. Platform will respond with:
     *   1. BATTLE_PLAYER_INFO → OnPlayerInfoReceived
     *   2. BATTLE_INVENTORY   → OnInventoryReceived
     *
     * @param {object} [options]
     * @param {boolean} [options.debug=false] — console.log every message
     */
    init: function (options) {
      if (this.initialized) {
        this._log("init() called twice — ignoring");
        return this;
      }
      this.initialized = true;
      this.debug = !!(options && options.debug);

      window.addEventListener("message", this._onMessage.bind(this));

      this._post({ type: "BATTLE_READY", engine: "unity" });
      this._post({ type: "BATTLE_GET_PLAYER_INFO" });

      this._log("ArcadeBattleSDK v" + this.version + " initialized");
      return this;
    },

    // ─── ROUND START ─────────────────────────────────────────────────
    /**
     * Signal that a round has started. Platform uses this to highlight
     * the round row in the sidebar (Round 3 running...).
     *
     * @param {number} round — 1 through 5
     */
    roundStart: function (round) {
      if (!this._preflight()) return;
      var r = parseInt(round);
      if (!(r >= 1 && r <= 5)) {
        console.warn("[ArcadeBattleSDK] roundStart: round must be 1-5, got:", round);
        return;
      }
      if (this._gameCompleted) {
        console.warn("[ArcadeBattleSDK] roundStart called after gameComplete — ignored");
        return;
      }
      // Enforce order: can't start round N+1 without ending round N
      if (r > 1 && !this._completedRounds[r - 1]) {
        console.warn("[ArcadeBattleSDK] roundStart(" + r + ") skipped — round " + (r - 1) + " not ended yet");
        return;
      }
      this._currentRound = r;
      this._post({ type: "BATTLE_ROUND_START", round: r });
      this._log("Round " + r + " started");
    },

    // ─── ROUND END ───────────────────────────────────────────────────
    /**
     * Signal that a round has ended and report dollars earned.
     *
     * @param {number} round   — 1 through 5
     * @param {number} dollars — non-negative integer, $ earned this round
     */
    roundEnd: function (round, dollars) {
      if (!this._preflight()) return;
      var r = parseInt(round);
      var d = parseInt(dollars);
      if (!(r >= 1 && r <= 5)) {
        console.warn("[ArcadeBattleSDK] roundEnd: round must be 1-5, got:", round);
        return;
      }
      if (!Number.isFinite(d) || d < 0) {
        console.warn("[ArcadeBattleSDK] roundEnd: dollars must be >= 0, got:", dollars);
        return;
      }
      if (this._gameCompleted) {
        console.warn("[ArcadeBattleSDK] roundEnd called after gameComplete — ignored");
        return;
      }
      if (this._completedRounds[r]) {
        console.warn("[ArcadeBattleSDK] roundEnd(" + r + ") called twice — ignored");
        return;
      }
      // Enforce order: can't end round N without ending round N-1 first
      if (r > 1 && !this._completedRounds[r - 1]) {
        console.warn("[ArcadeBattleSDK] roundEnd(" + r + ") out of order — round " + (r - 1) + " not ended");
        return;
      }
      this._completedRounds[r] = true;
      this._post({ type: "BATTLE_ROUND_END", round: r, dollars: d });
      this._log("Round " + r + " ended: $" + d);
    },

    // ─── GAME COMPLETE ───────────────────────────────────────────────
    /**
     * Signal that all 5 rounds are complete. Platform will show the
     * Claim button. Call this exactly once after roundEnd(5).
     */
    gameComplete: function () {
      if (!this._preflight()) return;
      if (this._gameCompleted) {
        console.warn("[ArcadeBattleSDK] gameComplete called twice — ignored");
        return;
      }
      // Must have completed all 5 rounds
      for (var i = 1; i <= 5; i++) {
        if (!this._completedRounds[i]) {
          console.warn("[ArcadeBattleSDK] gameComplete called before round " + i + " ended — ignored");
          return;
        }
      }
      this._gameCompleted = true;
      this._post({ type: "BATTLE_GAME_COMPLETE" });
      this._log("Game complete — all 5 rounds done");
    },

    // ─── OPEN SHOP ───────────────────────────────────────────────────
    /**
     * Request the platform to open its shop overlay. Use this to wire an
     * in-game "SHOP" button. The overlay renders on top of the iframe;
     * player picks + buys → BATTLE_ITEM_UNLOCKED + fresh BATTLE_INVENTORY
     * come back automatically.
     */
    openShop: function () {
      if (!this._preflight()) return;
      this._post({ type: "BATTLE_OPEN_SHOP" });
      this._log("Requested platform to open shop");
    },

    // ─── GET INVENTORY (refresh) ─────────────────────────────────────
    /**
     * Force the platform to resend the current inventory list. Useful if
     * the game state was lost (e.g. after a scene reload) and needs to
     * re-apply skins/environments. Platform will respond with a fresh
     * BATTLE_INVENTORY → OnInventoryReceived.
     */
    getInventory: function () {
      if (!this._preflight()) return;
      this._post({ type: "BATTLE_GET_INVENTORY" });
      this._log("Requested inventory refresh");
    },

    // ─── INTERNAL: post to parent ────────────────────────────────────
    _post: function (data) {
      try {
        var msg = Object.assign({}, data, {
          _arcadex_battle: true,
          version: this.version,
        });
        // Attach session token to gameplay messages so platform can validate
        if (this._sessionToken && (data.type === "BATTLE_ROUND_START" ||
                                    data.type === "BATTLE_ROUND_END" ||
                                    data.type === "BATTLE_GAME_COMPLETE")) {
          msg.sessionToken = this._sessionToken;
        }
        if (window.parent && window.parent !== window) {
          window.parent.postMessage(msg, "*");
        }
        window.postMessage(msg, "*");
      } catch (e) {
        console.error("[ArcadeBattleSDK] postMessage error:", e);
      }
    },

    _preflight: function () {
      if (!this.initialized) {
        console.warn("[ArcadeBattleSDK] SDK not initialized — call init() first");
        return false;
      }
      return true;
    },

    // ─── INTERNAL: Deliver a message to the C# BattleManager GameObject ──
    _toUnity: function (method, payload) {
      if (typeof SendMessage === "function") {
        try {
          SendMessage("BattleManager", method, payload);
        } catch (e) {
          console.error("[ArcadeBattleSDK] SendMessage " + method + " failed:", e);
        }
      } else {
        this._log("SendMessage unavailable (not in Unity build?) — " + method + ":", payload);
      }
    },

    // ─── INTERNAL: Receive platform → game messages ──────────────────
    _onMessage: function (e) {
      var d = e.data;
      if (!d || !d._platform) return;
      this._log("Platform message:", d.type);

      switch (d.type) {
        case "BATTLE_PLAYER_INFO":
          // Capture session token FIRST — used by all subsequent round posts
          if (d.sessionToken) this._sessionToken = d.sessionToken;
          var playerData = {
            address:   d.address   || "",
            chainName: d.chainName || "",
            chainId:   d.chainId   || 0,
          };
          if (typeof this.onPlayerInfo === "function") this.onPlayerInfo(playerData);
          this._toUnity("OnPlayerInfoReceived", JSON.stringify(playerData));
          break;

        case "BATTLE_INVENTORY":
          // Full inventory list — sent on init AND after every successful purchase
          var items = Array.isArray(d.items) ? d.items : [];
          this._inventory = items.slice();
          var inventoryData = { items: items };
          if (typeof this.onInventoryReceived === "function") this.onInventoryReceived(items);
          // Unity's JsonUtility can deserialize this shape into a class with `string[] items;`
          this._toUnity("OnInventoryReceived", JSON.stringify(inventoryData));
          break;

        case "BATTLE_ITEM_UNLOCKED":
          // Single-item unlock notification — good for showing "Item Unlocked!" toast
          // in the game. The full inventory list will arrive right after via
          // BATTLE_INVENTORY so the game has both the notification and the
          // authoritative list.
          var unlockedData = {
            itemId:   d.itemId   || "",
            category: d.category || "",
            name:     d.name     || "",
          };
          if (typeof this.onItemUnlocked === "function") this.onItemUnlocked(unlockedData);
          this._toUnity("OnItemUnlocked", JSON.stringify(unlockedData));
          break;

        case "BATTLE_CLAIM_STARTED":
          if (typeof this.onClaimStarted === "function") this.onClaimStarted();
          this._toUnity("OnClaimStarted", "");
          break;

        case "BATTLE_CLAIM_SUCCESS":
          var successData = {
            txHash:       d.txHash       || "",
            arcadeAmount: d.arcadeAmount || "0",
            explorerUrl:  d.explorerUrl  || "",
          };
          if (typeof this.onClaimSuccess === "function") this.onClaimSuccess(successData);
          this._toUnity("OnClaimSuccess", JSON.stringify(successData));
          break;

        case "BATTLE_CLAIM_FAILED":
          var failData = { error: d.error || "Claim failed" };
          if (typeof this.onClaimFailed === "function") this.onClaimFailed(failData);
          this._toUnity("OnClaimFailed", JSON.stringify(failData));
          break;

        default:
          break;
      }
    },

    _log: function () {
      if (this.debug) {
        var args = Array.prototype.slice.call(arguments);
        args.unshift("[ArcadeBattleSDK]");
        console.log.apply(console, args);
      }
    },
  };

  global.ArcadeBattleSDK = ArcadeBattleSDK;

  // NOTE: The C#→JS bridge is BattleBridge.jslib (Unity Plugins/WebGL folder),
  // which calls ArcadeBattleSDK.* methods directly. No window.battle_* globals
  // needed — keeping this file focused on the SDK object + SendMessage wiring
  // avoids version drift.

})(typeof window !== "undefined" ? window : this);