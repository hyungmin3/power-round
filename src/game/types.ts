export type HazardType = "poison" | "fire" | "water";

export type EnemyArchetype = "melee" | "spitter" | "boss";

export interface PersistedProfile {
  cash: number;
  bestTime: number;
  totalRuns: number;
  bossDefeats: number;
  unlockedTitle: boolean;
}

export interface ChallengeDefinition {
  id: string;
  title: string;
  description: string;
  rewardCash: number;
  rewardLabel: string;
}

export interface ChallengeProgress extends ChallengeDefinition {
  completed: boolean;
  progressText: string;
}

export interface PlayerState {
  maxHealth: number;
  health: number;
  speed: number;
  damage: number;
  reviveCost: number;
}

export interface RunState {
  survivalTime: number;
  enemiesDefeated: number;
  bossActive: boolean;
  bossDefeated: boolean;
  activeChallenges: ChallengeProgress[];
  revivalCount: number;
}

export interface GameConfig {
  arenaRadius: number;
  startingCash: number;
  retryCost: number;
  bossSpawnTime: number;
  challengeCountForBoss: number;
}
