/**
 * ArcadeX SDK v4.0.0 — Unity WebGL Edition
 * Place this file in your WebGLTemplate folder (so it's copied to the build root
 * on every build) or directly in the WebGL Build folder next to index.html.
 * https://www.playarcadex.in/sdk
 *
 * ArcadeBridge.jslib (Assets/Plugins/WebGL/) is the C#->JS bridge and calls the
 * ArcadeSDK global defined here. Platform -> game callbacks are delivered to a
 * GameObject named exactly "ArcadeManager" via Unity's SendMessage:
 *   OnTransactionSuccess(string txHash)
 *   OnTransactionFailed(string error)
 *   OnPlayerInfoReceived(string json)   // { address, balance }
 *   OnPurchaseSuccess(string json)      // PurchaseResult
 *   OnPurchaseFailed(string json)       // PurchaseResult
 */

(function (global) {
  "use strict";

  var ArcadeSDK = {
    version: "4.0.0",
    gameId: "",
    gameName: "",
    currentScore: 0,
    initialized: false,
    debug: false,

    // ─── INIT ────────────────────────────────────────────────
    init: function (gameId, gameName, options) {
      this.gameId = gameId || "";
      this.gameName = gameName || "";
      this.currentScore = 0;
      this.initialized = true;
      this.debug = (options && options.debug) || false;
      this._log("ArcadeX Unity SDK v" + this.version + " initialized", { gameId: this.gameId, gameName: this.gameName });
      this._post({ type: "ARCADE_SDK_READY", gameId: this.gameId, gameName: this.gameName, engine: "unity" });
      this._post({ type: "GET_PLAYER_INFO" });          // auto-fetch wallet info -> OnPlayerInfoReceived
      window.addEventListener("message", this._onMessage.bind(this));
      return this;
    },

    // ─── SCORE ────────────────────────────────────────────────
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

    pause:    function () { this._post({ type: "GAME_PAUSED",  gameId: this.gameId }); },
    resume:   function () { this._post({ type: "GAME_RESUMED", gameId: this.gameId }); },
    getScore: function () { return this.currentScore; },

    // ─── PURCHASE SKIN (pay + mint ERC-1155 NFT) ──────────────
    purchaseSkin: function (skinIndex, name, pinataCID, price) {
      if (skinIndex === undefined || skinIndex === null || !name || !pinataCID) {
        console.warn("[ArcadeSDK Unity] purchaseSkin: skinIndex, name and pinataCID are required");
        return;
      }
      var imageURI = String(pinataCID).indexOf("ipfs://") === 0 ? pinataCID : "ipfs://" + pinataCID;
      this._post({ type: "PURCHASE_SKIN", gameId: this.gameId, skinIndex: skinIndex, name: name, imageURI: imageURI, price: parseInt(price) || 0 });
      this._log("purchaseSkin:", skinIndex, name);
    },

    // ─── PURCHASE POWER-UP (pay only, no NFT) ─────────────────
    purchasePowerUp: function (powerUpId, price) {
      if (!powerUpId) { console.warn("[ArcadeSDK Unity] purchasePowerUp: powerUpId is required"); return; }
      this._post({ type: "PURCHASE_POWERUP", gameId: this.gameId, powerUpId: powerUpId, price: parseInt(price) || 0 });
      this._log("purchasePowerUp:", powerUpId);
    },

    getPlayerProfile: function () { this._post({ type: "GET_PLAYER_INFO", gameId: this.gameId }); },

    // ─── INTERNAL ─────────────────────────────────────────────
    _post: function (data) {
      try {
        var msg = Object.assign({}, data, { _arcadex: true, version: this.version });
        if (window.parent && window.parent !== window) window.parent.postMessage(msg, "*");
        window.postMessage(msg, "*");
      } catch (e) { console.error("[ArcadeSDK Unity] postMessage error:", e); }
    },

    // Deliver a message to the C# ArcadeManager GameObject
    _toUnity: function (method, payload) {
      if (typeof SendMessage === "function") {
        try { SendMessage("ArcadeManager", method, payload); }
        catch (e) { console.error("[ArcadeSDK Unity] SendMessage " + method + " failed:", e); }
      }
    },

    _onMessage: function (e) {
      var d = e.data;
      if (!d || !d._platform) return;
      this._log("Platform message:", d.type);

      switch (d.type) {
        case "TRANSACTION_SUCCESS":
          if (typeof this.onSuccess === "function") this.onSuccess(d.txHash);
          this._toUnity("OnTransactionSuccess", d.txHash || "");
          break;

        case "TRANSACTION_FAILED":
          console.warn("[ArcadeSDK Unity] TX failed:", d.error);
          if (typeof this.onError === "function") this.onError(d.error);
          this._toUnity("OnTransactionFailed", d.error || "");
          break;

        case "PLAYER_INFO":
          if (typeof this.onPlayerInfo === "function") this.onPlayerInfo(d.player || {});
          this._toUnity("OnPlayerInfoReceived", JSON.stringify(d.player || {}));
          break;

        case "PURCHASE_SUCCESS":
          if (typeof this.onPurchaseSuccess === "function") this.onPurchaseSuccess(d);
          this._toUnity("OnPurchaseSuccess", JSON.stringify(d));
          break;

        case "PURCHASE_FAILED":
          console.warn("[ArcadeSDK Unity] Purchase failed:", d.error);
          if (typeof this.onPurchaseFailed === "function") this.onPurchaseFailed(d);
          this._toUnity("OnPurchaseFailed", JSON.stringify(d));
          break;

        default: break;
      }
    },

    _log: function () {
      if (this.debug) { var a = Array.prototype.slice.call(arguments); a.unshift("[ArcadeSDK Unity]"); console.log.apply(console, a); }
    },
  };

  global.ArcadeSDK = ArcadeSDK;

  // NOTE: The C#->JS bridge is ArcadeBridge.jslib, which calls ArcadeSDK.* directly.
  // No window.arcade_* globals are needed here — keeping this file focused on the
  // ArcadeSDK object and the SendMessage callback wiring avoids version drift.

})(typeof window !== "undefined" ? window : this);
