import type { PersistedProfile } from "./types";

const STORAGE_KEY = "power-round-profile-v1";

export const DEFAULT_PROFILE: PersistedProfile = {
  cash: 1000,
  bestTime: 0,
  totalRuns: 0,
  bossDefeats: 0,
  unlockedTitle: false,
};

export function loadProfile(): PersistedProfile {
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    return { ...DEFAULT_PROFILE };
  }

  try {
    const parsed = JSON.parse(raw) as Partial<PersistedProfile>;
    return {
      cash: typeof parsed.cash === "number" ? parsed.cash : DEFAULT_PROFILE.cash,
      bestTime:
        typeof parsed.bestTime === "number"
          ? parsed.bestTime
          : DEFAULT_PROFILE.bestTime,
      totalRuns:
        typeof parsed.totalRuns === "number"
          ? parsed.totalRuns
          : DEFAULT_PROFILE.totalRuns,
      bossDefeats:
        typeof parsed.bossDefeats === "number"
          ? parsed.bossDefeats
          : DEFAULT_PROFILE.bossDefeats,
      unlockedTitle:
        typeof parsed.unlockedTitle === "boolean"
          ? parsed.unlockedTitle
          : DEFAULT_PROFILE.unlockedTitle,
    };
  } catch {
    return { ...DEFAULT_PROFILE };
  }
}

export function saveProfile(profile: PersistedProfile): void {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(profile));
}
