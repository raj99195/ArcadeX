/**
 * ArcadeX SDK v4.0.0
 * Integrate your game with ArcadeX (BOTChain & MST Blockchain — multi-chain EVM)
 * https://www.playarcadex.in/sdk
 *
 * Usage:
 *   ArcadeSDK.init("YOUR_GAME_ID");
 *   ArcadeSDK.updateScore(1500);
 *   ArcadeSDK.gameOver(9999);
 *
 *   // Pay + mint an NFT for a permanent skin — no registration step needed
 *   ArcadeSDK.purchaseSkin(0, "Batman", "bafkrei...", 10);
 *
 *   // Pay only, no NFT — for power-ups/boosts
 *   ArcadeSDK.purchasePowerUp("SCALE_BOOST", 5);
 */

(function (global) {
  "use strict";

  var ArcadeSDK = {
    version: "4.0.0",
    gameId: "",
    currentScore: 0,
    initialized: false,
    debug: false,

    // ─── INIT ────────────────────────────────────────────────
    init: function (gameId, options) {
      this.gameId = gameId || "";
      this.currentScore = 0;
      this.initialized = true;
      this.debug = (options && options.debug) || false;

      this._log("ArcadeX SDK v" + this.version + " initialized", {
        gameId: this.gameId,
        platform: window !== window.parent ? "iframe (ArcadeX)" : "standalone",
      });

      // Notify platform SDK is ready
      this._post({ type: "ARCADE_SDK_READY", gameId: this.gameId });
      this._post({ type: "GET_PLAYER_INFO" });

      // Listen for messages from platform
      window.addEventListener("message", this._onMessage.bind(this));

      return this;
    },

    // ─── UPDATE SCORE ─────────────────────────────────────────
    updateScore: function (score) {
      if (!this._requireInit("updateScore")) return;
      this.currentScore = parseInt(score) || 0;
      this._post({ type: "SCORE_UPDATE", score: this.currentScore, gameId: this.gameId });
      this._log("Score updated:", this.currentScore);
    },

    // ─── GAME OVER ────────────────────────────────────────────
    gameOver: function (finalScore) {
      if (!this._requireInit("gameOver")) return;
      var score = finalScore !== undefined ? parseInt(finalScore) : this.currentScore;
      this.currentScore = score;
      this._post({ type: "GAME_OVER", score: score, gameId: this.gameId });
      this._log("Game over submitted:", score);
    },

    // ─── PAUSE / RESUME ───────────────────────────────────────
    pause: function () {
      this._post({ type: "GAME_PAUSED", gameId: this.gameId });
      this._log("Game paused");
    },

    resume: function () {
      this._post({ type: "GAME_RESUMED", gameId: this.gameId });
      this._log("Game resumed");
    },

    // ─── GET SCORE ────────────────────────────────────────────
    getScore: function () {
      return this.currentScore;
    },

    // ─── PURCHASE SKIN ────────────────────────────────────────
    // Pay + mint an ERC-1155 NFT for a permanent skin/character. No
    // registration step — pass everything the game already knows about
    // this skin on every call.
    //   skinIndex : number  — unique index for this skin (0, 1, 2...)
    //   name      : string  — display name, e.g. "Batman"
    //   pinataCID : string  — IPFS CID (with or without "ipfs://" prefix)
    //   price     : number  — price in ARCADE/MSTC, whole tokens
    purchaseSkin: function (skinIndex, name, pinataCID, price) {
      if (!this._requireInit("purchaseSkin")) return;
      if (skinIndex === undefined || skinIndex === null || !name || !pinataCID) {
        console.warn("[ArcadeSDK] purchaseSkin: skinIndex, name and pinataCID are required");
        return;
      }
      var imageURI = String(pinataCID).indexOf("ipfs://") === 0 ? pinataCID : "ipfs://" + pinataCID;
      this._post({
        type: "PURCHASE_SKIN", gameId: this.gameId,
        skinIndex: skinIndex, name: name, imageURI: imageURI, price: parseInt(price) || 0,
      });
      this._log("purchaseSkin:", skinIndex, name, "| price:", price);
    },

    // ─── PURCHASE POWER-UP ────────────────────────────────────
    // Pay only, no NFT minted. Unlock/ownership state stays entirely on
    // your game side.
    //   powerUpId : string — unique identifier, e.g. "SCALE_BOOST"
    //   price     : number — price in ARCADE/MSTC, whole tokens
    purchasePowerUp: function (powerUpId, price) {
      if (!this._requireInit("purchasePowerUp")) return;
      if (!powerUpId) {
        console.warn("[ArcadeSDK] purchasePowerUp: powerUpId is required");
        return;
      }
      this._post({ type: "PURCHASE_POWERUP", gameId: this.gameId, powerUpId: powerUpId, price: parseInt(price) || 0 });
      this._log("purchasePowerUp:", powerUpId, "| price:", price);
    },

    // ─── RECORD GAME TIME / EVENT (off-chain, Firestore) ─────
    recordGameTime: function (seconds) {
      if (!this._requireInit("recordGameTime")) return;
      if (!seconds || seconds <= 0) return;
      this._post({ type: "RECORD_GAME_TIME", gameId: this.gameId, seconds: parseInt(seconds), timestamp: Date.now() });
      this._log("recordGameTime:", seconds, "seconds");
    },

    recordEvent: function (eventType, value) {
      if (!this._requireInit("recordEvent")) return;
      this._post({ type: "GAME_EVENT", gameId: this.gameId, eventType: eventType, value: parseInt(value) || 1, timestamp: Date.now() });
      this._log("recordEvent:", eventType, value);
    },

    // ─── GET PLAYER PROFILE ───────────────────────────────────
    getPlayerProfile: function () {
      if (!this._requireInit("getPlayerProfile")) return;
      this._post({ type: "GET_PLAYER_INFO" });
    },

    // ─── INTERNAL ─────────────────────────────────────────────
    _requireInit: function (fnName) {
      if (!this.initialized) {
        console.warn("[ArcadeSDK] Call init() before " + fnName + "()");
        return false;
      }
      return true;
    },

    _post: function (data) {
      try {
        var msg = Object.assign({}, data, { _arcadex: true, version: this.version });
        // Send to parent (ArcadeX platform iframe)
        if (window.parent && window.parent !== window) {
          window.parent.postMessage(msg, "*");
        }
        // Also send to current window for standalone testing
        window.postMessage(msg, "*");
      } catch (e) {
        console.error("[ArcadeSDK] postMessage failed:", e);
      }
    },

    _onMessage: function (event) {
      var data = event.data;
      if (!data || !data._platform) return;

      this._log("Platform message received:", data.type);

      switch (data.type) {
        case "PLAYER_INFO":
          this._log("Player connected:", data.player && data.player.address);
          if (typeof this.onPlayerInfo === "function") this.onPlayerInfo(data.player || {});
          break;

        case "TRANSACTION_SUCCESS":
          this._log("✅ Score submitted on-chain!", { txHash: data.txHash });
          if (typeof this.onSuccess === "function") this.onSuccess(data.txHash);
          break;

        case "TRANSACTION_FAILED":
          console.warn("[ArcadeSDK] ❌ Transaction failed:", data.error);
          if (typeof this.onError === "function") this.onError(data.error);
          break;

        case "PURCHASE_SUCCESS":
          this._log("✅ Purchase confirmed:", data.kind, data.skinIndex !== undefined ? data.skinIndex : data.powerUpId, "| tx:", data.txHash);
          if (typeof this.onPurchaseSuccess === "function") this.onPurchaseSuccess(data);
          break;

        case "PURCHASE_FAILED":
          console.warn("[ArcadeSDK] ❌ Purchase failed:", data.kind, "|", data.error);
          if (typeof this.onPurchaseFailed === "function") this.onPurchaseFailed(data);
          break;

        case "WALLET_CONNECTED":
          this._log("Wallet connected:", data.address);
          if (typeof this.onWalletConnected === "function") this.onWalletConnected(data.address);
          break;

        case "GAME_START":
          this._log("Game start signal from platform");
          if (typeof this.onGameStart === "function") this.onGameStart();
          break;

        default:
          break;
      }
    },

    _log: function () {
      if (this.debug) {
        var args = Array.prototype.slice.call(arguments);
        args.unshift("[ArcadeSDK]");
        console.log.apply(console, args);
      }
    },
  };

  // Expose globally
  global.ArcadeSDK = ArcadeSDK;

  // CommonJS / ES module support
  if (typeof module !== "undefined" && module.exports) {
    module.exports = ArcadeSDK;
  }

})(typeof window !== "undefined" ? window : this);
