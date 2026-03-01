import type { Principal } from "@icp-sdk/core/principal";
export interface Some<T> {
    __kind__: "Some";
    value: T;
}
export interface None {
    __kind__: "None";
}
export type Option<T> = Some<T> | None;
export interface LeaderboardEntry {
    name: string;
    score: bigint;
    timestamp: bigint;
}
export interface backendInterface {
    getLeaderboard(): Promise<Array<LeaderboardEntry>>;
    getPersonalBest(name: string): Promise<bigint | null>;
    submitScore(name: string, score: bigint): Promise<boolean>;
}
