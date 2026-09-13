import type { ParticleState, SceneState } from "../../shared/types";
export class InteractionMachine {
  state: SceneState = "OVERVIEW";
  particles: ParticleState = "ASSEMBLED";
  candidate: string | null = null;
  selected: string | null = null;
  get busy() {
    return this.state === "PULLING" || this.state === "PUSHING";
  }
  target(id: string | null) {
    if (this.state !== "OVERVIEW" && this.state !== "TARGETING") return;
    this.candidate = id;
    this.state = id ? "TARGETING" : "OVERVIEW";
  }
  pull(id: string) {
    if (this.busy || this.state === "FOCUSED") return false;
    this.selected = id;
    this.candidate = null;
    this.state = "PULLING";
    this.particles = "DISSOLVING";
    return true;
  }
  push() {
    if (
      this.state !== "FOCUSED" ||
      this.particles === "DISSOLVING" ||
      this.particles === "ASSEMBLING"
    )
      return false;
    this.state = "PUSHING";
    return true;
  }
  arrived() {
    if (this.state === "PULLING") this.state = "FOCUSED";
    else if (this.state === "PUSHING") {
      this.state = "OVERVIEW";
      this.selected = null;
      this.candidate = null;
    }
    this.particles = "ASSEMBLED";
  }
  toggleParticles() {
    if (
      this.state !== "FOCUSED" ||
      !["ASSEMBLED", "DISPERSED"].includes(this.particles)
    )
      return false;
    this.particles =
      this.particles === "ASSEMBLED" ? "DISSOLVING" : "ASSEMBLING";
    return true;
  }
  recover() {
    this.state = "OVERVIEW";
    this.particles = "ASSEMBLED";
    this.candidate = null;
    this.selected = null;
  }
}
