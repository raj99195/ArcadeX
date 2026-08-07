/**
 * ArcadeBridge.jslib — ArcadeX Unity WebGL Plugin (v4.0.0)
 * Place in: Assets/Plugins/WebGL/ArcadeBridge.jslib
 *
 * This is the REAL C#-to-JS bridge: every [DllImport("__Internal")] arcade_*
 * in ArcadeManager.cs resolves to a function below, which calls the ArcadeSDK
 * global defined in arcade-sdk-unity.js. Make sure arcade-sdk-unity.js is loaded
 * in the build (add it to your WebGLTemplate folder so it is copied on build).
 */

mergeInto(LibraryManager.library, {

  // C#: [DllImport("__Internal")] static extern void arcade_init(string gameId, string gameName);
  arcade_init: function (gameIdPtr, gameNamePtr) {
    var gameId   = gameIdPtr   ? UTF8ToString(gameIdPtr)   : "";
    var gameName = gameNamePtr ? UTF8ToString(gameNamePtr) : "";
    if (typeof ArcadeSDK !== "undefined") {
      ArcadeSDK.init(gameId, gameName);
    } else {
      console.warn("[ArcadeBridge] ArcadeSDK not loaded. Make sure arcade-sdk-unity.js is in your build folder.");
    }
  },

  // C#: [DllImport("__Internal")] static extern void arcade_updateScore(int score);
  arcade_updateScore: function (score) {
    if (typeof ArcadeSDK !== "undefined") ArcadeSDK.updateScore(score);
  },

  // C#: [DllImport("__Internal")] static extern void arcade_gameOver(int finalScore);
  arcade_gameOver: function (finalScore) {
    if (typeof ArcadeSDK !== "undefined") ArcadeSDK.gameOver(finalScore);
  },

  // C#: [DllImport("__Internal")] static extern void arcade_pause();
  arcade_pause: function () {
    if (typeof ArcadeSDK !== "undefined") ArcadeSDK.pause();
  },

  // C#: [DllImport("__Internal")] static extern void arcade_resume();
  arcade_resume: function () {
    if (typeof ArcadeSDK !== "undefined") ArcadeSDK.resume();
  },

  // C#: [DllImport("__Internal")] static extern int arcade_getScore();
  arcade_getScore: function () {
    if (typeof ArcadeSDK !== "undefined") return ArcadeSDK.getScore();
    return 0;
  },

  // C#: [DllImport("__Internal")] static extern void arcade_purchaseSkin(int skinIndex, string name, string pinataCID, int price);
  arcade_purchaseSkin: function (skinIndex, namePtr, cidPtr, price) {
    if (typeof ArcadeSDK === "undefined") return;
    var name = namePtr ? UTF8ToString(namePtr) : "";
    var cid  = cidPtr  ? UTF8ToString(cidPtr)  : "";
    ArcadeSDK.purchaseSkin(skinIndex, name, cid, price);
  },

  // C#: [DllImport("__Internal")] static extern void arcade_purchasePowerUp(string powerUpId, int price);
  arcade_purchasePowerUp: function (powerUpIdPtr, price) {
    if (typeof ArcadeSDK === "undefined") return;
    var powerUpId = powerUpIdPtr ? UTF8ToString(powerUpIdPtr) : "";
    ArcadeSDK.purchasePowerUp(powerUpId, price);
  },

});
