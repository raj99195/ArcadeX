/**
 * ArcadeX SDK v2.0.0 — Unity WebGL Edition
 * Place this file in your WebGL Build folder (same as index.html)
 * https://arcade-x-sand.vercel.app/sdk
 *
 * This file exposes global functions that ArcadeBridge.jslib calls from C#:
 *   arcade_init(gameId)
 *   arcade_updateScore(score)
 *   arcade_gameOver(finalScore)
 *   arcade_pause()
 *   arcade_resume()
 */

(function (global) {
  "use strict";

  // ─── Core SDK (same as arcade-sdk.js) ──────────────────────
  var ArcadeSDK = {
    version: "2.0.0",
    gameId: "",
    currentScore: 0,
    initialized: false,
    debug: false,

    init: function (gameId, options) {
      this.gameId = gameId || "";
      this.currentScore = 0;
      this.initialized = true;
      this.debug = (options && options.debug) || false;
      this._log("ArcadeX Unity SDK v" + this.version + " initialized", { gameId: this.gameId });
      this._post({ type: "ARCADE_SDK_READY", gameId: this.gameId, engine: "unity" });
      window.addEventListener("message", this._onMessage.bind(this));
      return this;
    },

    updateScore: function (score) {
      this.currentScore = parseInt(score) || 0;
      this._post({ type: "SCORE_UPDATE", score: this.currentScore, gameId: this.gameId });
      this._log("Score:", this.currentScore);
    },

    gameOver: function (finalScore) {
      var score = finalScore !== undefined ? parseInt(finalScore) : this.currentScore;
      this.currentScore = score;
      this._post({ type: "GAME_OVER", score: score, gameId: this.gameId });
      this._log("Game over:", score);
    },

    pause: function () { this._post({ type: "GAME_PAUSED", gameId: this.gameId }); },
    resume: function () { this._post({ type: "GAME_RESUMED", gameId: this.gameId }); },
    getScore: function () { return this.currentScore; },

    _post: function (data) {
      try {
        var msg = Object.assign({}, data, { _arcadex: true, version: this.version });
        if (window.parent && window.parent !== window) window.parent.postMessage(msg, "*");
        window.postMessage(msg, "*");
      } catch (e) { console.error("[ArcadeSDK] postMessage error:", e); }
    },

    _onMessage: function (e) {
      var d = e.data;
      if (!d || !d._platform) return;
      if (d.type === "TRANSACTION_SUCCESS") {
        this._log("✅ On-chain!", d.txHash);
        if (typeof this.onSuccess === "function") this.onSuccess(d.txHash);
        // Notify Unity via SendMessage if available
        if (typeof SendMessage === "function") {
          try { SendMessage("ArcadeManager", "OnTransactionSuccess", d.txHash || ""); } catch (e) {}
        }
      }
      if (d.type === "TRANSACTION_FAILED") {
        console.warn("[ArcadeSDK] ❌ TX Failed:", d.error);
        if (typeof this.onError === "function") this.onError(d.error);
        if (typeof SendMessage === "function") {
          try { SendMessage("ArcadeManager", "OnTransactionFailed", d.error || ""); } catch (e) {}
        }
      }
    },

    _log: function () {
      if (this.debug) { var a = Array.prototype.slice.call(arguments); a.unshift("[ArcadeSDK Unity]"); console.log.apply(console, a); }
    },
  };

  global.ArcadeSDK = ArcadeSDK;

  // ─── Unity C# Bridge Functions ─────────────────────────────
  // These are called by ArcadeBridge.jslib from C# via DllImport
  global.arcade_init = function (gameId) {
    ArcadeSDK.init(gameId ? UTF8ToString(gameId) : "");
  };

  global.arcade_updateScore = function (score) {
    ArcadeSDK.updateScore(score);
  };

  global.arcade_gameOver = function (finalScore) {
    ArcadeSDK.gameOver(finalScore);
  };

  global.arcade_pause = function () {
    ArcadeSDK.pause();
  };

  global.arcade_resume = function () {
    ArcadeSDK.resume();
  };

  global.arcade_getScore = function () {
    return ArcadeSDK.getScore();
  };

})(typeof window !== "undefined" ? window : this);
