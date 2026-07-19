/**
 * ArcadeX SDK v4.0.0 — Phaser 3 Edition
 * Place in your project folder (same as index.html)
 * https://arcade-x-sand.vercel.app/sdk
 *
 * Two ways to use:
 *
 * 1. Global (simple):
 *    ArcadeSDK.init("YOUR_GAME_ID");
 *    ArcadeSDK.updateScore(score);
 *    ArcadeSDK.gameOver(finalScore);
 *    ArcadeSDK.purchaseSkin(0, "Batman", "bafkrei...", 10);
 *    ArcadeSDK.purchasePowerUp("SCALE_BOOST", 5);
 *
 * 2. Phaser Scene Plugin (advanced):
 *    this.arcade.init("YOUR_GAME_ID");   // in scene create()
 *    this.arcade.updateScore(100);
 *    this.arcade.gameOver(9999);
 *    this.arcade.purchaseSkin(0, "Batman", "bafkrei...", 10);
 *    this.arcade.purchasePowerUp("SCALE_BOOST", 5);
 */

(function (global) {
  "use strict";

  // ─── Core SDK ───────────────────────────────────────────────
  var ArcadeSDK = {
    version: "4.0.0",
    gameId: "",
    currentScore: 0,
    initialized: false,
    debug: false,

    init: function (gameId, options) {
      this.gameId = gameId || "";
      this.currentScore = 0;
      this.initialized = true;
      this.debug = (options && options.debug) || false;
      this._log("ArcadeX Phaser SDK v" + this.version + " initialized", { gameId: this.gameId });
      this._post({ type: "ARCADE_SDK_READY", gameId: this.gameId, engine: "phaser" });
      this._post({ type: "GET_PLAYER_INFO" });
      window.addEventListener("message", this._onMessage.bind(this));
      return this;
    },

    updateScore: function (score) {
      if (!this._requireInit("updateScore")) return;
      this.currentScore = parseInt(score) || 0;
      this._post({ type: "SCORE_UPDATE", score: this.currentScore, gameId: this.gameId });
      this._log("Score:", this.currentScore);
    },

    gameOver: function (finalScore) {
      if (!this._requireInit("gameOver")) return;
      var score = finalScore !== undefined ? parseInt(finalScore) : this.currentScore;
      this.currentScore = score;
      this._post({ type: "GAME_OVER", score: score, gameId: this.gameId });
      this._log("Game over:", score);
    },

    pause:    function () { this._post({ type: "GAME_PAUSED",  gameId: this.gameId }); },
    resume:   function () { this._post({ type: "GAME_RESUMED", gameId: this.gameId }); },
    getScore: function () { return this.currentScore; },

    // ─── PURCHASE SKIN ────────────────────────────────────────
    purchaseSkin: function (skinIndex, name, pinataCID, price) {
      if (!this._requireInit("purchaseSkin")) return;
      if (skinIndex === undefined || skinIndex === null || !name || !pinataCID) {
        console.warn("[ArcadeSDK Phaser] purchaseSkin: skinIndex, name and pinataCID are required");
        return;
      }
      var imageURI = String(pinataCID).indexOf("ipfs://") === 0 ? pinataCID : "ipfs://" + pinataCID;
      this._post({ type: "PURCHASE_SKIN", gameId: this.gameId, skinIndex: skinIndex, name: name, imageURI: imageURI, price: parseInt(price) || 0 });
      this._log("purchaseSkin:", skinIndex, name);
    },

    // ─── PURCHASE POWER-UP ────────────────────────────────────
    purchasePowerUp: function (powerUpId, price) {
      if (!this._requireInit("purchasePowerUp")) return;
      if (!powerUpId) { console.warn("[ArcadeSDK Phaser] purchasePowerUp: powerUpId is required"); return; }
      this._post({ type: "PURCHASE_POWERUP", gameId: this.gameId, powerUpId: powerUpId, price: parseInt(price) || 0 });
      this._log("purchasePowerUp:", powerUpId);
    },

    // ─── RECORD GAME TIME / EVENT (off-chain) ─────────────────
    recordGameTime: function (seconds) {
      if (!this._requireInit("recordGameTime")) return;
      if (!seconds || seconds <= 0) return;
      this._post({ type: "RECORD_GAME_TIME", gameId: this.gameId, seconds: parseInt(seconds), timestamp: Date.now() });
    },

    recordEvent: function (eventType, value) {
      if (!this._requireInit("recordEvent")) return;
      this._post({ type: "GAME_EVENT", gameId: this.gameId, eventType: eventType, value: parseInt(value) || 1, timestamp: Date.now() });
    },

    getPlayerProfile: function () {
      if (!this._requireInit("getPlayerProfile")) return;
      this._post({ type: "GET_PLAYER_INFO" });
    },

    _requireInit: function (fnName) {
      if (!this.initialized) { console.warn("[ArcadeSDK Phaser] Call init() before " + fnName + "()"); return false; }
      return true;
    },

    _post: function (data) {
      try {
        var msg = Object.assign({}, data, { _arcadex: true, version: this.version });
        if (window.parent && window.parent !== window) window.parent.postMessage(msg, "*");
        window.postMessage(msg, "*");
      } catch (e) { console.error("[ArcadeSDK Phaser] postMessage error:", e); }
    },

    _onMessage: function (e) {
      var d = e.data;
      if (!d || !d._platform) return;
      this._log("Platform:", d.type);

      if (d.type === "PLAYER_INFO") {
        this._log("Player connected:", d.player && d.player.address);
        if (typeof this.onPlayerInfo === "function") this.onPlayerInfo(d.player || {});
      }
      if (d.type === "TRANSACTION_SUCCESS") {
        this._log("✅ On-chain!", d.txHash);
        if (typeof this.onSuccess === "function") this.onSuccess(d.txHash);
      }
      if (d.type === "TRANSACTION_FAILED") {
        console.warn("[ArcadeSDK Phaser] ❌ Failed:", d.error);
        if (typeof this.onError === "function") this.onError(d.error);
      }
      if (d.type === "PURCHASE_SUCCESS") {
        this._log("✅ Purchase confirmed:", d.kind, "| tx:", d.txHash);
        if (typeof this.onPurchaseSuccess === "function") this.onPurchaseSuccess(d);
      }
      if (d.type === "PURCHASE_FAILED") {
        console.warn("[ArcadeSDK Phaser] ❌ Purchase failed:", d.kind, "|", d.error);
        if (typeof this.onPurchaseFailed === "function") this.onPurchaseFailed(d);
      }
      if (d.type === "GAME_START") {
        if (typeof this.onGameStart === "function") this.onGameStart();
      }
    },

    _log: function () {
      if (this.debug) {
        var a = Array.prototype.slice.call(arguments);
        a.unshift("[ArcadeSDK Phaser]");
        console.log.apply(console, a);
      }
    },
  };

  global.ArcadeSDK = ArcadeSDK;

  // ─── Phaser 3 Scene Plugin ───────────────────────────────────
  // Optional: use as this.arcade in any Phaser Scene
  if (typeof Phaser !== "undefined") {
    var ArcadePlugin = new Phaser.Class({
      Extends: Phaser.Plugins.ScenePlugin,

      initialize: function ArcadePlugin(scene, pluginManager) {
        Phaser.Plugins.ScenePlugin.call(this, scene, pluginManager);
        this.sdk = ArcadeSDK;
      },

      init: function (gameId, options) {
        return this.sdk.init(gameId, options);
      },

      updateScore: function (score) {
        this.sdk.updateScore(score);
        return this;
      },

      gameOver: function (finalScore) {
        this.sdk.gameOver(finalScore);
        return this;
      },

      pause:    function () { this.sdk.pause(); return this; },
      resume:   function () { this.sdk.resume(); return this; },
      getScore: function () { return this.sdk.getScore(); },

      purchaseSkin: function (skinIndex, name, pinataCID, price) {
        this.sdk.purchaseSkin(skinIndex, name, pinataCID, price);
        return this;
      },
      purchasePowerUp: function (powerUpId, price) {
        this.sdk.purchasePowerUp(powerUpId, price);
        return this;
      },
      recordGameTime: function (seconds) { this.sdk.recordGameTime(seconds); return this; },
      recordEvent: function (eventType, value) { this.sdk.recordEvent(eventType, value); return this; },
      getPlayerProfile: function () { this.sdk.getPlayerProfile(); return this; },

      onSuccess:         function (cb) { this.sdk.onSuccess = cb; return this; },
      onError:           function (cb) { this.sdk.onError = cb; return this; },
      onPurchaseSuccess: function (cb) { this.sdk.onPurchaseSuccess = cb; return this; },
      onPurchaseFailed:  function (cb) { this.sdk.onPurchaseFailed = cb; return this; },
      onPlayerInfo:      function (cb) { this.sdk.onPlayerInfo = cb; return this; },
    });

    // Register plugin — available as this.arcade in scenes
    Phaser.GameObjects.GameObjectFactory.register("arcade", function () {
      return new ArcadePlugin(this.scene, this.scene.sys.plugins);
    });

    global.ArcadePlugin = ArcadePlugin;
    this._log("Phaser plugin registered as 'arcade'");
  }

})(typeof window !== "undefined" ? window : this);

/*
 * ─── Phaser 3 Usage Example ──────────────────────────────────
 *
 * // index.html
 * <script src="arcade-sdk-phaser.js"></script>
 *
 * // GameScene.js
 * class GameScene extends Phaser.Scene {
 *   constructor() { super({ key: "GameScene" }); }
 *
 *   create() {
 *     // Option 1: Global (simple)
 *     ArcadeSDK.init("YOUR_GAME_ID");
 *
 *     // Option 2: Plugin (advanced)
 *     // this.arcade.init("YOUR_GAME_ID");
 *   }
 *
 *   update() {
 *     // Update score in realtime
 *     this.score += 1;
 *     if (this.score % 100 === 0) {
 *       ArcadeSDK.updateScore(this.score);
 *     }
 *   }
 *
 *   onGameOver() {
 *     ArcadeSDK.gameOver(this.score);
 *
 *     // Handle response
 *     ArcadeSDK.onSuccess = function(txHash) {
 *       console.log("Score saved on-chain:", txHash);
 *     };
 *     ArcadeSDK.onError = function(err) {
 *       console.error("Failed:", err);
 *     };
 *   }
 *
 *   onBuySkinButtonClick() {
 *     // Pay + mint an NFT for a permanent skin — one call, no registration
 *     ArcadeSDK.purchaseSkin(0, "Batman", "bafkrei...", 10);
 *     ArcadeSDK.onPurchaseSuccess = function(data) {
 *       console.log("Skin unlocked, tokenId:", data.tokenId);
 *     };
 *     ArcadeSDK.onPurchaseFailed = function(data) {
 *       console.error("Purchase failed:", data.error);
 *     };
 *   }
 *
 *   onBuyPowerUpButtonClick() {
 *     // Pay only, no NFT
 *     ArcadeSDK.purchasePowerUp("SCALE_BOOST", 5);
 *   }
 * }
 */
