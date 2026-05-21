/**
 * ArcadeX SDK v2.0.0 — Phaser 3 Edition
 * Place in your project folder (same as index.html)
 * https://arcade-x-sand.vercel.app/sdk
 *
 * Two ways to use:
 *
 * 1. Global (simple):
 *    ArcadeSDK.init("YOUR_GAME_ID");
 *    ArcadeSDK.updateScore(score);
 *    ArcadeSDK.gameOver(finalScore);
 *
 * 2. Phaser Scene Plugin (advanced):
 *    this.arcade.init("YOUR_GAME_ID");   // in scene create()
 *    this.arcade.updateScore(100);
 *    this.arcade.gameOver(9999);
 */

(function (global) {
  "use strict";

  // ─── Core SDK ───────────────────────────────────────────────
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
      this._log("ArcadeX Phaser SDK v" + this.version + " initialized", { gameId: this.gameId });
      this._post({ type: "ARCADE_SDK_READY", gameId: this.gameId, engine: "phaser" });
      window.addEventListener("message", this._onMessage.bind(this));
      return this;
    },

    updateScore: function (score) {
      if (!this.initialized) { console.warn("[ArcadeSDK Phaser] Call init() first"); return; }
      this.currentScore = parseInt(score) || 0;
      this._post({ type: "SCORE_UPDATE", score: this.currentScore, gameId: this.gameId });
      this._log("Score:", this.currentScore);
    },

    gameOver: function (finalScore) {
      if (!this.initialized) { console.warn("[ArcadeSDK Phaser] Call init() first"); return; }
      var score = finalScore !== undefined ? parseInt(finalScore) : this.currentScore;
      this.currentScore = score;
      this._post({ type: "GAME_OVER", score: score, gameId: this.gameId });
      this._log("Game over:", score);
    },

    pause:    function () { this._post({ type: "GAME_PAUSED",  gameId: this.gameId }); },
    resume:   function () { this._post({ type: "GAME_RESUMED", gameId: this.gameId }); },
    getScore: function () { return this.currentScore; },

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
      if (d.type === "TRANSACTION_SUCCESS") {
        this._log("✅ On-chain!", d.txHash);
        if (typeof this.onSuccess === "function") this.onSuccess(d.txHash);
      }
      if (d.type === "TRANSACTION_FAILED") {
        console.warn("[ArcadeSDK Phaser] ❌ Failed:", d.error);
        if (typeof this.onError === "function") this.onError(d.error);
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

      onSuccess: function (cb) { this.sdk.onSuccess = cb; return this; },
      onError:   function (cb) { this.sdk.onError = cb; return this; },
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
 * }
 */
