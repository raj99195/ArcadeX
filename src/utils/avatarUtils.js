// src/utils/avatarUtils.js
// Avatar style helpers — used by Navbar + Marketplace

export function getActiveAvatarStyle(address) {
  if (!address) return "bottts";
  return localStorage.getItem(`avatar_style_${address.toLowerCase()}`) || "bottts";
}

export function setActiveAvatarStyle(address, style) {
  if (!address) return;
  localStorage.setItem(`avatar_style_${address.toLowerCase()}`, style);
  window.dispatchEvent(new Event("avatar_style_changed"));
}

export function getUnlockedStyles(address) {
  if (!address) return ["bottts", "pixel-art"];
  try {
    const saved = localStorage.getItem(`unlocked_styles_${address.toLowerCase()}`);
    const unlocked = saved ? JSON.parse(saved) : [];
    return ["bottts", "pixel-art", ...unlocked];
  } catch { return ["bottts", "pixel-art"]; }
}

export function unlockAvatarStyle(address, style) {
  if (!address) return;
  const current = getUnlockedStyles(address).filter(s => s !== "bottts" && s !== "pixel-art");
  if (!current.includes(style)) {
    localStorage.setItem(
      `unlocked_styles_${address.toLowerCase()}`,
      JSON.stringify([...current, style])
    );
  }
}
