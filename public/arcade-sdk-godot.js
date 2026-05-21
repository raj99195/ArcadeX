/**
 * ArcadeX SDK v2.0.0 — Godot HTML5 Edition
 * Place in your Godot HTML5 export folder (same as index.html)
 * https://arcade-x-sand.vercel.app/sdk
 *
 * In your Godot export index.html, add before </head>:
 *   <script src="arcade-sdk-godot.js"></script>
 *
 * Then in GDScript (Godot 3.x):
 *   JavaScript.eval("ArcadeSDK.init('YOUR_GAME_ID')")
 *   JavaScript.eval("ArcadeSDK.updateScore(100)")
 *   JavaScript.eval("ArcadeSDK.gameOver(9999)")
 *
 * Godot 4.x — replace JavaScript.eval() with JavaScriptBridge.eval()
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
      this._log("ArcadeX Godot SDK v" + this.version + " initialized", { gameId: this.gameId });
      this._post({ type: "ARCADE_SDK_READY", gameId: this.gameId, engine: "godot" });
      window.addEventListener("message", this._onMessage.bind(this));
      return this;
    },

    // ─── UPDATE SCORE ─────────────────────────────────────────
    updateScore: function (score) {
      if (!this.initialized) { console.warn("[ArcadeSDK Godot] Call init() first"); return; }
      this.currentScore = parseInt(score) || 0;
      this._post({ type: "SCORE_UPDATE", score: this.currentScore, gameId: this.gameId });
      this._log("Score updated:", this.currentScore);
    },

    // ─── GAME OVER ────────────────────────────────────────────
    gameOver: function (finalScore) {
      if (!this.initialized) { console.warn("[ArcadeSDK Godot] Call init() first"); return; }
      var score = finalScore !== undefined ? parseInt(finalScore) : this.currentScore;
      this.currentScore = score;
      this._post({ type: "GAME_OVER", score: score, gameId: this.gameId });
      this._log("Game over:", score);
    },

    pause:    function () { this._post({ type: "GAME_PAUSED",  gameId: this.gameId }); },
    resume:   function () { this._post({ type: "GAME_RESUMED", gameId: this.gameId }); },
    getScore: function () { return this.currentScore; },

    // ─── INTERNAL ─────────────────────────────────────────────
    _post: function (data) {
      try {
        var msg = Object.assign({}, data, { _arcadex: true, version: this.version });
        if (window.parent && window.parent !== window) window.parent.postMessage(msg, "*");
        window.postMessage(msg, "*");
      } catch (e) { console.error("[ArcadeSDK Godot] postMessage error:", e); }
    },

    _onMessage: function (e) {
      var d = e.data;
      if (!d || !d._platform) return;
      this._log("Platform message:", d.type);

      if (d.type === "TRANSACTION_SUCCESS") {
        this._log("✅ Score on-chain!", d.txHash);
        if (typeof this.onSuccess === "function") this.onSuccess(d.txHash);
        // Signal Godot via window callback if set
        if (typeof global._arcadex_on_success === "function") global._arcadex_on_success(d.txHash || "");
      }
      if (d.type === "TRANSACTION_FAILED") {
        console.warn("[ArcadeSDK Godot] ❌ TX Failed:", d.error);
        if (typeof this.onError === "function") this.onError(d.error);
        if (typeof global._arcadex_on_error === "function") global._arcadex_on_error(d.error || "");
      }
      if (d.type === "GAME_START") {
        if (typeof this.onGameStart === "function") this.onGameStart();
        if (typeof global._arcadex_on_start === "function") global._arcadex_on_start();
      }
    },

    _log: function () {
      if (this.debug) {
        var a = Array.prototype.slice.call(arguments);
        a.unshift("[ArcadeSDK Godot]");
        console.log.apply(console, a);
      }
    },
  };

  global.ArcadeSDK = ArcadeSDK;

})(typeof window !== "undefined" ? window : this);

/*
 * ─── GODOT 3.x GDScript Example ─────────────────────────────
 *
 * # ArcadeSDK.gd — add as AutoLoad singleton
 * extends Node
 *
 * var game_id = "YOUR_GAME_ID"
 *
 * func _ready():
 *     if OS.has_feature("JavaScript"):
 *         JavaScript.eval("ArcadeSDK.init('" + game_id + "')")
 *
 * func update_score(score: int):
 *     if OS.has_feature("JavaScript"):
 *         JavaScript.eval("ArcadeSDK.updateScore(" + str(score) + ")")
 *
 * func game_over(final_score: int):
 *     if OS.has_feature("JavaScript"):
 *         JavaScript.eval("ArcadeSDK.gameOver(" + str(final_score) + ")")
 *
 * ─── GODOT 4.x GDScript Example ─────────────────────────────
 *
 * func _ready():
 *     if OS.has_feature("web"):
 *         JavaScriptBridge.eval("ArcadeSDK.init('" + game_id + "')")
 *
 * func update_score(score: int):
 *     if OS.has_feature("web"):
 *         JavaScriptBridge.eval("ArcadeSDK.updateScore(" + str(score) + ")")
 *
 * func game_over(final_score: int):
 *     if OS.has_feature("web"):
 *         JavaScriptBridge.eval("ArcadeSDK.gameOver(" + str(final_score) + ")")
 */
