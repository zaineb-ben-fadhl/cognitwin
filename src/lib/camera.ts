/**
 * Optional, on-device camera cues (bonus "emotion-aware" feature, opt-in only).
 *
 * Frames are processed in the browser by MediaPipe Face Landmarker and immediately discarded:
 * only four running averages leave this module (brow tension, eye closure, looking away,
 * smile). No image, landmark or identity data is stored or transmitted. These cues can only
 * nudge the coach's tone — see engine/affect.ts, which never lets them decide alone.
 */
import type { CameraCues } from '@/engine';

type Landmarker = {
  detectForVideo(video: HTMLVideoElement, ts: number): {
    faceLandmarks: Array<Array<{ x: number; y: number }>>;
    faceBlendshapes?: Array<{ categories: Array<{ categoryName: string; score: number }> }>;
  };
  close(): void;
};

const WASM_URL = `${import.meta.env.BASE_URL}models/wasm`;
const MODEL_URL = `${import.meta.env.BASE_URL}models/face_landmarker.task`;

export class CameraCueTracker {
  private stream: MediaStream | null = null;
  private landmarker: Landmarker | null = null;
  private video: HTMLVideoElement | null = null;
  private raf = 0;
  private lastTs = 0;
  private generation = 0;
  constructor(private readonly onError: (error: unknown) => void = () => {}) {}
  private sums = { samples: 0, brow: 0, closed: 0, away: 0, smile: 0 };

  async start(video: HTMLVideoElement): Promise<void> {
    this.stop();
    const generation = this.generation;
    this.reset();
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 320, height: 240, facingMode: 'user' }, audio: false });
      if (generation !== this.generation) { stream.getTracks().forEach((t) => t.stop()); return; }
      this.stream = stream;
      this.video = video;
      video.srcObject = stream;
      await video.play();
      if (generation !== this.generation) return;
      const vision = await import('@mediapipe/tasks-vision');
      const fileset = await vision.FilesetResolver.forVisionTasks(WASM_URL);
      if (generation !== this.generation) return;
      const create = (delegate: 'GPU' | 'CPU') => vision.FaceLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: MODEL_URL, delegate }, runningMode: 'VIDEO', numFaces: 1, outputFaceBlendshapes: true,
      });
      let model: Landmarker;
      try { model = await create('GPU') as unknown as Landmarker; }
      catch (error) {
        if (generation !== this.generation) return;
        model = await create('CPU') as unknown as Landmarker;
      }
      if (generation !== this.generation) { model.close(); return; }
      this.landmarker = model;
      this.loop();
    } catch (error) {
      if (generation !== this.generation) return;
      this.stop();
      throw error;
    }
  }

  private loop = () => {
    this.raf = requestAnimationFrame(this.loop);
    const now = performance.now();
    // ~4 samples per second is plenty for coarse cues and keeps CPU use low.
    if (!this.landmarker || !this.video || now - this.lastTs < 250 || this.video.readyState < 2) return;
    this.lastTs = now;
    let res: ReturnType<Landmarker['detectForVideo']>;
    try { res = this.landmarker.detectForVideo(this.video, now); }
    catch (error) { this.stop(); this.onError(error); return; }
    this.sums.samples++;
    const face = res.faceLandmarks[0];
    if (!face) {
      this.sums.away++;
      return;
    }
    const shapes = new Map((res.faceBlendshapes?.[0]?.categories ?? []).map((c) => [c.categoryName, c.score]));
    const g = (k: string) => shapes.get(k) ?? 0;
    this.sums.brow += (g('browDownLeft') + g('browDownRight')) / 2;
    this.sums.smile += (g('mouthSmileLeft') + g('mouthSmileRight')) / 2;
    if (g('eyeBlinkLeft') > 0.55 && g('eyeBlinkRight') > 0.55) this.sums.closed++;
    // Head yaw proxy: nose tip position between the two cheek landmarks.
    const nose = face[1];
    const left = face[234];
    const right = face[454];
    if (nose && left && right) {
      const ratio = (nose.x - left.x) / Math.max(1e-6, right.x - left.x);
      if (Math.abs(ratio - 0.5) > 0.2) this.sums.away++;
    }
  };

  cues(): CameraCues {
    const n = Math.max(1, this.sums.samples);
    return {
      samples: this.sums.samples,
      browTension: this.sums.brow / n,
      eyeClosure: this.sums.closed / n,
      gazeAway: this.sums.away / n,
      smile: this.sums.smile / n,
    };
  }

  reset(): void {
    this.sums = { samples: 0, brow: 0, closed: 0, away: 0, smile: 0 };
    this.lastTs = 0;
  }

  stop(): void {
    this.generation++;
    cancelAnimationFrame(this.raf);
    this.landmarker?.close();
    this.landmarker = null;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    if (this.video) this.video.srcObject = null;
    this.video = null;
  }
}
