/**
 * ArcadeX SDK v2.0.0
 * Integrate your game with ArcadeX on BOTChain EVM
 * https://arcade-x-sand.vercel.app/sdk
 *
 * Usage:
 *   ArcadeSDK.init("YOUR_GAME_ID");
 *   ArcadeSDK.updateScore(1500);
 *   ArcadeSDK.gameOver(9999);
 */

(function (global) {
  "use strict";

  var ArcadeSDK = {
    version: "2.0.0",
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

      // Listen for messages from platform
      window.addEventListener("message", this._onMessage.bind(this));

      return this;
    },

    // ─── UPDATE SCORE ─────────────────────────────────────────
    updateScore: function (score) {
      if (!this.initialized) {
        console.warn("[ArcadeSDK] Call init() before updateScore()");
        return;
      }
      this.currentScore = parseInt(score) || 0;
      this._post({ type: "SCORE_UPDATE", score: this.currentScore, gameId: this.gameId });
      this._log("Score updated:", this.currentScore);
    },

    // ─── GAME OVER ────────────────────────────────────────────
    gameOver: function (finalScore) {
      if (!this.initialized) {
        console.warn("[ArcadeSDK] Call init() before gameOver()");
        return;
      }
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

    // ─── INTERNAL ─────────────────────────────────────────────
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
        case "TRANSACTION_SUCCESS":
          this._log("✅ Score submitted on-chain!", { txHash: data.txHash });
          if (typeof this.onSuccess === "function") this.onSuccess(data.txHash);
          break;

        case "TRANSACTION_FAILED":
          console.warn("[ArcadeSDK] ❌ Transaction failed:", data.error);
          if (typeof this.onError === "function") this.onError(data.error);
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
