/** Stands in for `three/webgpu` (see vite.config.ts). Asking for the WebGPU renderer fails with a clear message; WebGL is the only renderer used. */
export class WebGPURenderer {
  constructor() {
    throw new Error("The WebGPU renderer is not part of this build. Use WebGL.");
  }
}
