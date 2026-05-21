/**
 * ArcadeBridge.jslib — ArcadeX Unity WebGL Plugin
 * Place in: Assets/Plugins/WebGL/ArcadeBridge.jslib
 *
 * This file bridges C# DllImport calls to arcade-sdk-unity.js
 * Unity automatically includes this in WebGL builds.
 */

mergeInto(LibraryManager.library, {

  // Initialize SDK with Game ID
  // C#: [DllImport("__Internal")] static extern void arcade_init(string gameId);
  arcade_init: function (gameIdPtr) {
    var gameId = gameIdPtr ? UTF8ToString(gameIdPtr) : "";
    if (typeof ArcadeSDK !== "undefined") {
      ArcadeSDK.init(gameId);
    } else {
      console.warn("[ArcadeBridge] ArcadeSDK not loaded. Make sure arcade-sdk-unity.js is in your build folder.");
    }
  },

  // Update score during gameplay
  // C#: [DllImport("__Internal")] static extern void arcade_updateScore(int score);
  arcade_updateScore: function (score) {
    if (typeof ArcadeSDK !== "undefined") {
      ArcadeSDK.updateScore(score);
    }
  },

  // Submit final score on game over
  // C#: [DllImport("__Internal")] static extern void arcade_gameOver(int finalScore);
  arcade_gameOver: function (finalScore) {
    if (typeof ArcadeSDK !== "undefined") {
      ArcadeSDK.gameOver(finalScore);
    }
  },

  // Pause signal
  // C#: [DllImport("__Internal")] static extern void arcade_pause();
  arcade_pause: function () {
    if (typeof ArcadeSDK !== "undefined") {
      ArcadeSDK.pause();
    }
  },

  // Resume signal
  // C#: [DllImport("__Internal")] static extern void arcade_resume();
  arcade_resume: function () {
    if (typeof ArcadeSDK !== "undefined") {
      ArcadeSDK.resume();
    }
  },

  // Get current score (returns int)
  // C#: [DllImport("__Internal")] static extern int arcade_getScore();
  arcade_getScore: function () {
    if (typeof ArcadeSDK !== "undefined") {
      return ArcadeSDK.getScore();
    }
    return 0;
  },

});
