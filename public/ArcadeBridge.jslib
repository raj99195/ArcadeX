mergeInto(LibraryManager.library, {

  arcade_init: function(gameId) {
    var id = UTF8ToString(gameId);
    if (typeof window.arcade_init !== 'undefined') {
      window.arcade_init(id);
    }
  },

  arcade_gameOver: function(score) {
    if (typeof window.arcade_gameOver !== 'undefined') {
      window.arcade_gameOver(score);
    }
  },

  arcade_updateScore: function(score) {
    if (typeof window.arcade_updateScore !== 'undefined') {
      window.arcade_updateScore(score);
    }
  },

  arcade_earnTokens: function(amount) {
    if (typeof window.arcade_earnTokens !== 'undefined') {
      window.arcade_earnTokens(amount);
    }
  },

  arcade_levelComplete: function(level, score) {
    if (typeof window.arcade_levelComplete !== 'undefined') {
      window.arcade_levelComplete(level, score);
    }
  },

});