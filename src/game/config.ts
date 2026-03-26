import type { ChallengeDefinition, GameConfig } from "./types";

export const GAME_CONFIG: GameConfig = {
  arenaRadius: 72,
  startingCash: 1000,
  retryCost: 100,
  bossSpawnTime: 120,
  challengeCountForBoss: 2,
};

export const CHALLENGES: ChallengeDefinition[] = [
  {
    id: "survive-minute",
    title: "Hold the Line",
    description: "Survive for 75 seconds while the arena keeps spawning threats.",
    rewardCash: 220,
    rewardLabel: "+$220 and a full heal",
  },
  {
    id: "slay-pack",
    title: "Break the Pack",
    description: "Defeat 10 monsters before the altar wakes the boss.",
    rewardCash: 260,
    rewardLabel: "+$260 and overcharged strikes",
  },
  {
    id: "claim-relic",
    title: "Take the Ridge Relic",
    description: "Reach the relic on the northern ridge to unlock a speed surge.",
    rewardCash: 180,
    rewardLabel: "+$180 and a speed surge",
  },
];
