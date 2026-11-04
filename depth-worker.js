importScripts("https://cdn.jsdelivr.net/npm/onnxruntime-web@1.17.3/dist/ort.min.js");

const MODEL_URL = new URL("./assets/fastdepth.onnx", self.location.href).href;
const ORT_BASE = "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.17.3/dist/";
let sessionPromise;

async function getSession() {
  if (!sessionPromise) {
    ort.env.wasm.wasmPaths = ORT_BASE;
    ort.env.wasm.numThreads = 1;
    sessionPromise = ort.InferenceSession.create(MODEL_URL, { executionProviders: ["wasm"] });
  }
  return sessionPromise;
}

self.onmessage = async (event) => {
  const { id, pixels } = event.data;
  try {
    const session = await getSession();
    const input = new ort.Tensor("float32", new Float32Array(pixels), [1, 3, 224, 224]);
    const output = (await session.run({ [session.inputNames[0]]: input }))[session.outputNames[0]];
    const dims = output.dims;
    const srcW = dims[dims.length - 1] || 224;
    const srcH = dims[dims.length - 2] || 224;
    const result = new Float32Array(224 * 224);
    let low = Infinity;
    let high = -Infinity;

    for (let y = 0; y < 224; y++) {
      const sy = Math.min(srcH - 1, Math.floor(y * srcH / 224));
      for (let x = 0; x < 224; x++) {
        const sx = Math.min(srcW - 1, Math.floor(x * srcW / 224));
        const i = sy * srcW + sx;
        const depth = 1 / Math.max(0.05, Number(output.data[i]));
        result[y * 224 + x] = depth;
        low = Math.min(low, depth);
        high = Math.max(high, depth);
      }
    }

    const range = high - low || 1;
    for (let y = 0; y < 224; y++) {
      const row = y * 224;
      for (let x = 0; x < 224; x++) {
        const i = row + x;
        const luminance = pixels[i] * 0.299 + pixels[224 * 224 + i] * 0.587 + pixels[2 * 224 * 224 + i] * 0.114;
        const modelDepth = (result[i] - low) / range;
        result[i] = modelDepth * 0.8 + luminance * 0.2;
      }
    }

    self.postMessage({ id, values: result }, [result.buffer]);
  } catch (error) {
    self.postMessage({ id, error: error && error.message ? error.message : String(error) });
  }
};
