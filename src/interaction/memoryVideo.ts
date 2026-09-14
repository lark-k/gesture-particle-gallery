export class MemoryVideoState {
  private frameAvailable = false;
  private rewindPending = false;

  get hasFrame() { return this.frameAvailable; }

  /** A loop seek can temporarily drop readyState without invalidating the GPU's last frame. */
  update(readyState: number, failed: boolean, active: boolean, restored: boolean) {
    if (failed) this.frameAvailable = false;
    else if (readyState >= 2) this.frameAvailable = true;
    if (active) this.rewindPending = true;
    const rewind = !active && restored && this.rewindPending;
    if (rewind) this.rewindPending = false;
    return { hasFrame: this.frameAvailable, rewind };
  }

  invalidateFrame() {
    this.frameAvailable = false;
  }
}

type LoopMedia = Pick<HTMLVideoElement, "readyState" | "seeking" | "ended" | "paused" | "play" | "pause" | "load">;

/** Decode the next complete play on a separate element, never seek the visible video. */
export class MemoryVideoLoop {
  index = 0;
  cycles = 0;
  private pending: number | null = null;
  private fadeElapsed = 0;
  private fadeUpdatedAt: number | null = null;
  private wanted = false;
  private disposed = false;

  constructor(private readonly media: readonly [LoopMedia, LoopMedia]) {}

  get nextIndex() { return this.pending ?? this.index; }
  get blend() {
    const t = Math.min(1, this.fadeElapsed / 650);
    return t * t * (3 - 2 * t);
  }

  setWanted(wanted: boolean) {
    if (this.disposed || wanted === this.wanted) return;
    this.wanted = wanted;
    this.fadeUpdatedAt = null;
    if (!wanted) {
      this.media.forEach(video => video.pause());
    }
    else if (this.pending !== null) this.start(this.pending);
    else if (!this.media[this.index].ended) this.start(this.index);
  }

  advance(now = performance.now()) {
    if (!this.wanted || this.disposed) return;
    if (this.pending !== null) {
      const next = this.media[this.pending];
      if (next.readyState < 2 || next.seeking || next.paused) {
        this.fadeUpdatedAt = null;
        return;
      }
      // Keep the outgoing decoder's final frame alive until the incoming picture is fully visible.
      if (this.fadeUpdatedAt !== null) this.fadeElapsed += Math.max(0, now - this.fadeUpdatedAt);
      this.fadeUpdatedAt = now;
      if (this.fadeElapsed < 650) return;
      const previous = this.index;
      this.index = this.pending;
      this.pending = null;
      this.fadeElapsed = 0;
      this.fadeUpdatedAt = null;
      this.cycles++;
      this.media[previous].pause();
      // Reinitialize the hidden decoder instead of carrying native loop/seek state forward.
      this.media[previous].load();
    }
    if (this.media[this.index].ended && this.pending === null) {
      // Start immediately at the boundary; crossfade instead of inserting a still-frame pause.
      this.pending = 1 - this.index;
      this.start(this.pending);
    }
  }

  reset() {
    if (this.disposed) return;
    this.wanted = false;
    this.pending = null;
    this.fadeElapsed = 0;
    this.fadeUpdatedAt = null;
    this.index = 0;
    this.media.forEach(video => { video.pause(); video.load(); });
  }

  dispose() {
    this.disposed = true;
    this.wanted = false;
    this.media.forEach(video => video.pause());
  }

  private start(index: number) {
    void this.media[index].play().then(() => {
      if (this.disposed || !this.wanted || index !== this.index && index !== this.pending) this.media[index].pause();
    }).catch(() => { /* Preserve the current picture if browser playback is blocked. */ });
  }
}
