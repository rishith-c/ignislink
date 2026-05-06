// Off-main-thread ONNX inference worker.
//
// The R3F render loop runs on the main thread. Even with onnxruntime-web's
// internal SIMD/multithreaded WASM, the JS-side data marshalling and
// result decoding can hitch a frame on slower devices, so we move both into
// a dedicated worker.
//
// Message protocol (all messages tagged by an integer `id` so a single
// worker can serve multiple in-flight requests):
//
//     main → worker:
//         { type: "init",   id, modelUrl: string }
//         { type: "infer",  id, data: Float32Array, shape: number[] }
//
//     worker → main:
//         { type: "ready",  id }
//         { type: "result", id, p1h: Float32Array, p6h: Float32Array,
//                              p24h: Float32Array, dims: [H, W] }
//         { type: "error",  id, message: string }

import * as ort from "onnxruntime-web";

type InitMessage = { type: "init"; id: number; modelUrl: string };
type InferMessage = {
  type: "infer";
  id: number;
  data: Float32Array;
  shape: readonly number[];
};
type WorkerInbound = InitMessage | InferMessage;

let session: ort.InferenceSession | null = null;
let inputName: string | null = null;
let outputName: string | null = null;

async function initSession(modelUrl: string): Promise<void> {
  // wasm backend: works without WebGPU and is the most portable target.
  ort.env.wasm.numThreads = Math.max(
    1,
    Math.min(4, (self.navigator?.hardwareConcurrency ?? 2) - 1),
  );
  // Browsers serve the wasm files from `onnxruntime-web/dist/...`. Vite/Next
  // pull them in via the package's exported assets; default base path works
  // for our setup.
  session = await ort.InferenceSession.create(modelUrl, {
    executionProviders: ["wasm"],
    graphOptimizationLevel: "all",
  });
  inputName = session.inputNames[0] ?? null;
  outputName = session.outputNames[0] ?? null;
  if (!inputName || !outputName) {
    throw new Error("ONNX session has no named input/output");
  }
}

async function runInfer(message: InferMessage): Promise<void> {
  if (!session || !inputName || !outputName) {
    throw new Error("ONNX session not initialized");
  }
  const tensor = new ort.Tensor("float32", message.data, message.shape as number[]);
  const feeds: Record<string, ort.Tensor> = {};
  feeds[inputName] = tensor;
  const out = await session.run(feeds);
  const outTensor = out[outputName];
  if (!outTensor) {
    throw new Error(`ONNX output tensor "${outputName}" missing from result`);
  }
  // Output shape: (B=1, 3, H, W). Slice into three per-horizon Float32Arrays.
  const dims = outTensor.dims;
  if (dims.length !== 4 || dims[0] !== 1 || dims[1] !== 3) {
    throw new Error(
      `Unexpected ONNX output shape ${JSON.stringify(dims)}; expected (1, 3, H, W)`,
    );
  }
  const H = dims[2] as number;
  const W = dims[3] as number;
  const plane = H * W;
  const flat = outTensor.data as Float32Array;
  const p1h = new Float32Array(flat.buffer, flat.byteOffset + 0 * plane * 4, plane);
  const p6h = new Float32Array(flat.buffer, flat.byteOffset + 1 * plane * 4, plane);
  const p24h = new Float32Array(flat.buffer, flat.byteOffset + 2 * plane * 4, plane);
  // Copy out into independent buffers so we can transfer them.
  const p1hCopy = new Float32Array(p1h);
  const p6hCopy = new Float32Array(p6h);
  const p24hCopy = new Float32Array(p24h);
  (self as unknown as Worker).postMessage(
    {
      type: "result",
      id: message.id,
      p1h: p1hCopy,
      p6h: p6hCopy,
      p24h: p24hCopy,
      dims: [H, W],
    },
    [p1hCopy.buffer, p6hCopy.buffer, p24hCopy.buffer],
  );
}

self.addEventListener("message", (event: MessageEvent<WorkerInbound>) => {
  const message = event.data;
  void (async () => {
    try {
      if (message.type === "init") {
        await initSession(message.modelUrl);
        (self as unknown as Worker).postMessage({ type: "ready", id: message.id });
      } else if (message.type === "infer") {
        await runInfer(message);
      }
    } catch (error: unknown) {
      const errMsg = error instanceof Error ? error.message : String(error);
      (self as unknown as Worker).postMessage({
        type: "error",
        id: message.id,
        message: errMsg,
      });
    }
  })();
});
