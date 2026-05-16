/**
 * InitiaArcade SDK v1.0.1
 *
 * Connect your Unity WebGL game to the InitiaArcade platform.
 * Include this file in your WebGL build to enable on-chain scoring,
 * token rewards, and blockchain interactions.
 *
 * Documentation: https://initia-arcade.vercel.app/sdk
 * Platform:      https://initia-arcade.vercel.app
 */

(function () {
  "use strict";

  var _gameId   = null;
  var _debug    = false;
  var _ready    = false;
  var _platform = window.parent;

  function _log() {
    if (_debug) {
      var args = Array.prototype.slice.call(arguments);
      args.unshift("[ArcadeSDK]");
      console.log.apply(console, args);
    }
  }

  function _warn() {
    var args = Array.prototype.slice.call(arguments);
    args.unshift("[ArcadeSDK]");
    console.warn.apply(console, args);
  }

  function _send(type, data) {
    if (!_ready && type !== "SDK_READY") {
      _warn("SDK not initialized. Call ArcadeSDK.init() first.");
      return;
    }
    try {
      var payload = Object.assign({}, data, {
        type: type,
        _sdk: true,
        gameId: _gameId,
        sdkVersion: "1.0.1",
      });
      _platform.postMessage(payload, "*");
      _log("Event sent →", type, data);
    } catch (e) {
      console.error("[ArcadeSDK] postMessage failed:", e);
    }
  }

  window.addEventListener("message", function (event) {
    if (!event.data || !event.data._platform) return;
    var type = event.data.type;
    if (type === "TRANSACTION_SUCCESS") {
      _log("Transaction confirmed:", event.data.txHash);
    }
    if (type === "TRANSACTION_FAILED") {
      _warn("Transaction failed:", event.data.error);
    }
    if (type === "PLAYER_INFO") {
      _log("Player info received:", event.data.player);
    }
  });

  var ArcadeSDK = {

    version: "1.0.1",

    /**
     * Initialize the SDK. Must be called once when the game loads.
     * @param {string|number} gameId   - Your game ID from the platform dashboard.
     * @param {object}        [options]
     * @param {boolean}       [options.debug=false] - Enable verbose console logging.
     */
    init: function (gameId, options) {
      _gameId = String(gameId);
      _debug  = (options && options.debug === true);
      _ready  = true;
      _log("SDK initialized — Game ID:", _gameId);
      _send("SDK_READY", { gameId: _gameId });
    },

    /**
     * Send a real-time score update to the platform UI.
     * Does NOT trigger a blockchain transaction.
     * @param {number} score - The player's current score.
     */
    updateScore: function (score) {
      _send("SCORE_UPDATE", { score: Number(score) });
    },

    /**
     * Signal game over and submit the final score on-chain.
     * If auto-sign is enabled, this triggers a silent blockchain transaction.
     * @param {number} finalScore - The player's final score for this session.
     */
    gameOver: function (finalScore) {
      _log("Game over — submitting score:", finalScore);
      _send("GAME_OVER", { score: Number(finalScore) });
    },

    /**
     * Award ARCADE tokens to the player for in-game achievements.
     * @param {number} amount - Number of ARCADE tokens to award.
     */
    earnTokens: function (amount) {
      _send("EARN_TOKENS", { amount: Number(amount) });
      _log("Earn tokens:", amount, "ARCADE");
    },

    /**
     * Deduct ARCADE tokens from the player's wallet for an in-game purchase.
     * @param {string} itemId - Unique identifier for the item.
     * @param {number} price  - Cost of the item in ARCADE tokens.
     */
    buyItem: function (itemId, price) {
      _send("BUY_ITEM", { itemId: String(itemId), price: Number(price) });
      _log("Buy item:", itemId, "| Price:", price, "ARCADE");
    },

    /**
     * Unlock an on-chain achievement badge for the player.
     * @param {string} achievementId - Unique identifier for the achievement.
     */
    unlockAchievement: function (achievementId) {
      _send("UNLOCK_ACHIEVEMENT", { achievementId: String(achievementId) });
      _log("Achievement unlocked:", achievementId);
    },

    /**
     * Record level completion on-chain.
     * @param {number} level - The level number that was completed.
     * @param {number} score - Score achieved on this level.
     */
    levelComplete: function (level, score) {
      _send("LEVEL_COMPLETE", { level: Number(level), score: Number(score) });
      _log("Level complete:", level, "| Score:", score);
    },

    /**
     * Request the connected player's wallet information from the platform.
     * @param {function} callback - Called with { address, username, balance }.
     */
    getPlayerInfo: function (callback) {
      if (typeof callback !== "function") {
        _warn("getPlayerInfo requires a callback function.");
        return;
      }
      _send("GET_PLAYER_INFO", {});
      var handler = function (event) {
        if (event.data && event.data.type === "PLAYER_INFO" && event.data._platform) {
          callback(event.data.player);
          window.removeEventListener("message", handler);
        }
      };
      window.addEventListener("message", handler);
      setTimeout(function () {
        window.removeEventListener("message", handler);
      }, 10000);
    },

    /** @returns {boolean} Whether the SDK has been initialized. */
    isReady: function () { return _ready; },

    /** @returns {string|null} The current game ID. */
    getGameId: function () { return _gameId; },
  };

  // ── Unity C# bridge ─────────────────────────────────────────
  // Use these with Application.ExternalCall() in your C# scripts.
  // Example: Application.ExternalCall("arcade_gameOver", finalScore);

  window.arcade_init = function (gameId, debug) {
    ArcadeSDK.init(gameId, { debug: debug === "true" || debug === true });
  };
  window.arcade_updateScore      = function (score)                { ArcadeSDK.updateScore(score); };
  window.arcade_gameOver         = function (score)                { ArcadeSDK.gameOver(score); };
  window.arcade_earnTokens       = function (amount)               { ArcadeSDK.earnTokens(amount); };
  window.arcade_buyItem          = function (itemId, price)        { ArcadeSDK.buyItem(itemId, price); };
  window.arcade_unlockAchievement= function (achievementId)        { ArcadeSDK.unlockAchievement(achievementId); };
  window.arcade_levelComplete    = function (level, score)         { ArcadeSDK.levelComplete(level, score); };
  window.arcade_isReady          = function ()                     { return ArcadeSDK.isReady(); };

  window.arcade_getPlayerInfo = function (callbackName) {
    ArcadeSDK.getPlayerInfo(function (player) {
      if (window.gameInstance) {
        window.gameInstance.SendMessage(
          "ArcadeManager",
          callbackName,
          JSON.stringify(player)
        );
      }
    });
  };

  window.ArcadeSDK = ArcadeSDK;

  console.log(
    "%c InitiaArcade SDK v1.0.1 ",
    "background:#00FF88;color:#000;padding:4px 10px;border-radius:4px;font-weight:bold;"
  );

})();
