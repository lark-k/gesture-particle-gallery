export interface Photo {
  id: string;
  name: string;
  width: number;
  height: number;
  thumbUrl: string;
  fullUrl?: string;
  expiresAt?: number;
  createdAt: string;
  source: "sample" | "local" | "oss";
  objectKey?: string;
  thumbKey?: string;
}
export type SceneState =
  | "OVERVIEW"
  | "TARGETING"
  | "PULLING"
  | "FOCUSED"
  | "PUSHING";
export type ParticleState =
  | "ASSEMBLED"
  | "DISSOLVING"
  | "DISPERSED"
  | "ASSEMBLING";
export type Quality = "low" | "medium" | "high";
