/**
 * ArcadeX SDK v4.0.0 — Godot HTML5 Edition
 * Place in your Godot HTML5 export folder (same as index.html)
 * https://www.playarcadex.in/sdk
 *
 * In your Godot export index.html, add before </head>:
 *   <script src="arcade-sdk-godot.js"></script>
 *
 * Then in GDScript (Godot 3.x):
 *   JavaScript.eval("ArcadeSDK.init('YOUR_GAME_ID')")
 *   JavaScript.eval("ArcadeSDK.updateScore(100)")
 *   JavaScript.eval("ArcadeSDK.gameOver(9999)")
 *   JavaScript.eval("ArcadeSDK.purchaseSkin(0, 'Batman', 'bafkrei...', 10)")
 *   JavaScript.eval("ArcadeSDK.purchasePowerUp('SCALE_BOOST', 5)")
 *
 * Godot 4.x — replace JavaScript.eval() with JavaScriptBridge.eval()
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
      this._log("ArcadeX Godot SDK v" + this.version + " initialized", { gameId: this.gameId });
      this._post({ type: "ARCADE_SDK_READY", gameId: this.gameId, engine: "godot" });
      this._post({ type: "GET_PLAYER_INFO" });
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
      this._log("Game over:", score);
    },

    pause:    function () { this._post({ type: "GAME_PAUSED",  gameId: this.gameId }); },
    resume:   function () { this._post({ type: "GAME_RESUMED", gameId: this.gameId }); },
    getScore: function () { return this.currentScore; },

    // ─── PURCHASE SKIN ────────────────────────────────────────
    // Pay + mint an ERC-1155 NFT for a permanent skin. No registration
    // step — pass gameId/skinIndex/name/pinataCID/price on every call.
    purchaseSkin: function (skinIndex, name, pinataCID, price) {
      if (!this._requireInit("purchaseSkin")) return;
      if (skinIndex === undefined || skinIndex === null || !name || !pinataCID) {
        console.warn("[ArcadeSDK Godot] purchaseSkin: skinIndex, name and pinataCID are required");
        return;
      }
      var imageURI = String(pinataCID).indexOf("ipfs://") === 0 ? pinataCID : "ipfs://" + pinataCID;
      this._post({ type: "PURCHASE_SKIN", gameId: this.gameId, skinIndex: skinIndex, name: name, imageURI: imageURI, price: parseInt(price) || 0 });
      this._log("purchaseSkin:", skinIndex, name);
    },

    // ─── PURCHASE POWER-UP ────────────────────────────────────
    // Pay only, no NFT — ownership state stays on the game side.
    purchasePowerUp: function (powerUpId, price) {
      if (!this._requireInit("purchasePowerUp")) return;
      if (!powerUpId) { console.warn("[ArcadeSDK Godot] purchasePowerUp: powerUpId is required"); return; }
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

    // ─── INTERNAL ─────────────────────────────────────────────
    _requireInit: function (fnName) {
      if (!this.initialized) { console.warn("[ArcadeSDK Godot] Call init() before " + fnName + "()"); return false; }
      return true;
    },

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

      if (d.type === "PLAYER_INFO") {
        this._log("Player connected:", d.player && d.player.address);
        if (typeof this.onPlayerInfo === "function") this.onPlayerInfo(d.player || {});
        if (typeof global._arcadex_on_player_info === "function") global._arcadex_on_player_info(JSON.stringify(d.player || {}));
      }
      if (d.type === "TRANSACTION_SUCCESS") {
        this._log("✅ Score on-chain!", d.txHash);
        if (typeof this.onSuccess === "function") this.onSuccess(d.txHash);
        if (typeof global._arcadex_on_success === "function") global._arcadex_on_success(d.txHash || "");
      }
      if (d.type === "TRANSACTION_FAILED") {
        console.warn("[ArcadeSDK Godot] ❌ TX Failed:", d.error);
        if (typeof this.onError === "function") this.onError(d.error);
        if (typeof global._arcadex_on_error === "function") global._arcadex_on_error(d.error || "");
      }
      if (d.type === "PURCHASE_SUCCESS") {
        this._log("✅ Purchase confirmed:", d.kind, "| tx:", d.txHash);
        if (typeof this.onPurchaseSuccess === "function") this.onPurchaseSuccess(d);
        if (typeof global._arcadex_on_purchase_success === "function") global._arcadex_on_purchase_success(JSON.stringify(d));
      }
      if (d.type === "PURCHASE_FAILED") {
        console.warn("[ArcadeSDK Godot] ❌ Purchase failed:", d.kind, "|", d.error);
        if (typeof this.onPurchaseFailed === "function") this.onPurchaseFailed(d);
        if (typeof global._arcadex_on_purchase_failed === "function") global._arcadex_on_purchase_failed(JSON.stringify(d));
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
 * # Pay + mint an NFT for a permanent skin — no registration step needed
 * func purchase_skin(skin_index: int, skin_name: String, pinata_cid: String, price: int):
 *     if OS.has_feature("JavaScript"):
 *         JavaScript.eval("ArcadeSDK.purchaseSkin(" + str(skin_index) + ", '" + skin_name + "', '" + pinata_cid + "', " + str(price) + ")")
 *
 * # Pay only, no NFT — for power-ups/boosts
 * func purchase_power_up(power_up_id: String, price: int):
 *     if OS.has_feature("JavaScript"):
 *         JavaScript.eval("ArcadeSDK.purchasePowerUp('" + power_up_id + "', " + str(price) + ")")
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
 *
 * func purchase_skin(skin_index: int, skin_name: String, pinata_cid: String, price: int):
 *     if OS.has_feature("web"):
 *         JavaScriptBridge.eval("ArcadeSDK.purchaseSkin(" + str(skin_index) + ", '" + skin_name + "', '" + pinata_cid + "', " + str(price) + ")")
 *
 * func purchase_power_up(power_up_id: String, price: int):
 *     if OS.has_feature("web"):
 *         JavaScriptBridge.eval("ArcadeSDK.purchasePowerUp('" + power_up_id + "', " + str(price) + ")")
 */
