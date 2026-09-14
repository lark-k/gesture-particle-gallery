export interface Photo {
  id: string;
  albumId?: string;
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
export interface Album {
  id: string;
  name: string;
  description: string;
  theme: "forest" | "lake" | "meadow";
  coverPreset: string;
  coverPhotoId: string | null;
  coverUrl: string;
  coverX: number;
  coverY: number;
  photoCount: number;
  createdAt: string;
  updatedAt: string;
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
