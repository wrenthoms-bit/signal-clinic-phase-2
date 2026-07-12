/**
 * These are hand-written from the packages' published READMEs, not the
 * packages' own shipped types — this sandbox has no network access to
 * actually `npm install` them. Delete this file once you've run `npm
 * install` for real: if either package ships its own types (likely),
 * this stub would only shadow the real, more accurate ones.
 */

declare module 'demucs-web' {
  export interface StemChannelPair {
    left: Float32Array;
    right: Float32Array;
  }

  export interface SeparationResult {
    drums: StemChannelPair;
    bass: StemChannelPair;
    other: StemChannelPair;
    vocals: StemChannelPair;
  }

  export interface ProgressInfo {
    progress: number;
    currentSegment: number;
    totalSegments: number;
  }

  export interface DemucsProcessorOptions {
    ort: unknown;
    modelPath?: string;
    sessionOptions?: Record<string, unknown>;
    onProgress?: (info: ProgressInfo) => void;
    onLog?: (phase: string, message: string) => void;
    onDownloadProgress?: (loaded: number, total: number) => void;
  }

  export class DemucsProcessor {
    constructor(options: DemucsProcessorOptions);
    loadModel(pathOrBuffer?: string | ArrayBuffer): Promise<void>;
    separate(left: Float32Array, right: Float32Array): Promise<SeparationResult>;
  }

  export const CONSTANTS: { DEFAULT_MODEL_URL: string };
}

// Only ever referenced here as an opaque module reference passed through
// to DemucsProcessor's constructor — our code never calls into it
// directly, so there's no need to model its actual shape.
declare module 'onnxruntime-web';
