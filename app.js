const $ = (selector) => document.querySelector(selector);
const picker = $("#file-picker");
const cloud = $("#cloud");
const dropZone = $("#drop-zone");
const emptyState = $("#empty-state");
const statusLine = $("#model-status");
const toast = $("#toast");
const sourceRow = $("#source-row");
const copyButton = $("#copy-embed");
const downloadButton = $("#download-html");
const embedField = $("#embed-code");
const MAX_FILE_BYTES = 25 * 1024 * 1024;
const MAX_IMAGE_SIDE = 520;
const MODEL_SIDE = 224;

let sourceImage = "";
let depthImage = "";
let sourceName = "";
let currentColor = "#ffe9c4";
let worker = null;
let requestId = 0;
let pending = new Map();
let toastTimer = 0;

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("show"), 2100);
}

function updateOptions() {
  const options = {
    amplitude: Number($("#depth-range").value) / 100,
    drift: Number($("#drift-range").value) / 100,
    pointSize: Number($("#size-range").value) / 10,
    tint: currentColor
  };
  $("#depth-value").value = $("#depth-range").value;
  $("#drift-value").value = $("#drift-range").value;
  $("#size-value").value = $("#size-range").value;
  cloud.setOptions(options);
  if (sourceImage) updateEmbed();
}

function getWorker() {
  if (worker) return worker;
  worker = new Worker("./depth-worker.js");
  worker.onmessage = (event) => {
    const item = pending.get(event.data.id);
    if (!item) return;
    clearTimeout(item.timer);
    pending.delete(event.data.id);
    if (event.data.error) item.reject(new Error(event.data.error));
    else item.resolve(event.data.values);
  };
  worker.onerror = (event) => {
    const error = new Error(event.message || "The depth worker could not load.");
    pending.forEach((item) => {
      clearTimeout(item.timer);
      item.reject(error);
    });
    pending.clear();
    worker.terminate();
    worker = null;
  };
  return worker;
}

function inferDepth(tensor) {
  const activeWorker = getWorker();
  return new Promise((resolve, reject) => {
    const id = ++requestId;
    const timer = setTimeout(() => {
      pending.delete(id);
      activeWorker.terminate();
      if (worker === activeWorker) worker = null;
      reject(new Error("The depth model took too long to load."));
    }, 30000);
    pending.set(id, { resolve, reject, timer });
    activeWorker.postMessage({ id, pixels: tensor }, [tensor.buffer]);
  });
}

async function decodeImage(file) {
  try {
    return await createImageBitmap(file);
  } catch (error) {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.src = url;
    try {
      await image.decode();
    } catch (_decodeError) {
      URL.revokeObjectURL(url);
      throw error;
    }
    return {
      width: image.naturalWidth,
      height: image.naturalHeight,
      drawable: image,
      close: () => URL.revokeObjectURL(url)
    };
  }
}

function makeModelInput(bitmap) {
  const canvas = document.createElement("canvas");
  canvas.width = MODEL_SIDE;
  canvas.height = MODEL_SIDE;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, MODEL_SIDE, MODEL_SIDE);
  const scale = Math.min(MODEL_SIDE / bitmap.width, MODEL_SIDE / bitmap.height);
  const drawWidth = bitmap.width * scale;
  const drawHeight = bitmap.height * scale;
  const offsetX = (MODEL_SIDE - drawWidth) / 2;
  const offsetY = (MODEL_SIDE - drawHeight) / 2;
  ctx.drawImage(bitmap.drawable || bitmap, offsetX, offsetY, drawWidth, drawHeight);

  const rgba = ctx.getImageData(0, 0, MODEL_SIDE, MODEL_SIDE).data;
  const count = MODEL_SIDE * MODEL_SIDE;
  const tensor = new Float32Array(count * 3);
  const luma = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const r = rgba[i * 4] / 255;
    const g = rgba[i * 4 + 1] / 255;
    const b = rgba[i * 4 + 2] / 255;
    tensor[i] = r;
    tensor[count + i] = g;
    tensor[count * 2 + i] = b;
    luma[i] = (0.299 * r + 0.587 * g + 0.114 * b);
  }
  return { tensor, luma, offsetX, offsetY, drawWidth, drawHeight };
}

function makeSource(bitmap) {
  const scale = Math.min(1, MAX_IMAGE_SIDE / bitmap.width, MAX_IMAGE_SIDE / bitmap.height);
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  canvas.getContext("2d").drawImage(bitmap.drawable || bitmap, 0, 0, width, height);
  return { canvas, width, height, data: canvas.toDataURL("image/png") };
}

function makeDepth(values, width, height, fit) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  const image = ctx.createImageData(width, height);
  const mapWidth = MODEL_SIDE;
  const mapHeight = MODEL_SIDE;
  for (let y = 0; y < height; y++) {
    const modelY = Math.min(mapHeight - 1, Math.floor(fit.offsetY + (y + 0.5) * fit.drawHeight / height));
    for (let x = 0; x < width; x++) {
      const modelX = Math.min(mapWidth - 1, Math.floor(fit.offsetX + (x + 0.5) * fit.drawWidth / width));
      const value = Math.max(0, Math.min(255, Math.round(values[modelY * mapWidth + modelX] * 255)));
      const index = (y * width + x) * 4;
      image.data[index] = value;
      image.data[index + 1] = value;
      image.data[index + 2] = value;
      image.data[index + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
  return canvas.toDataURL("image/png");
}

function setSourceUI(file, bitmap, source) {
  sourceImage = source.data;
  sourceName = file.name;
  $("#active-name").textContent = file.name.toUpperCase();
  $("#source-name").textContent = file.name;
  $("#source-dimensions").textContent = bitmap.width + " × " + bitmap.height;
  $("#thumb").style.backgroundImage = "url('" + sourceImage + "')";
  sourceRow.hidden = false;
  emptyState.hidden = true;
  copyButton.disabled = false;
  downloadButton.disabled = false;
}

async function handleFile(file) {
  if (!file) return;
  if (file.type && !file.type.startsWith("image/")) {
    showToast("Choose an image file.");
    return;
  }
  if (file.size > MAX_FILE_BYTES) {
    showToast("That image is over 25 MB.");
    return;
  }

  statusLine.textContent = "READING IMAGE · KEEP THIS TAB OPEN";
  let bitmap;
  try {
    bitmap = await decodeImage(file);
    const source = makeSource(bitmap);
    const model = makeModelInput(bitmap);
    setSourceUI(file, bitmap, source);
    statusLine.textContent = "LOADING DEPTH MODEL · IMAGE STAYS LOCAL";

    let depthValues;
    let fallback = false;
    try {
      depthValues = await inferDepth(model.tensor);
    } catch (_error) {
      // shortcut: luminance has no scene geometry; restore FastDepth when the runtime is reachable.
      depthValues = model.luma;
      fallback = true;
    }
    depthImage = makeDepth(depthValues, source.width, source.height, model);
    await cloud.setData({ image: sourceImage, depth: depthImage });
    updateOptions();
    $("#point-count").textContent = cloud.pointCount.toLocaleString() + " POINTS";
    statusLine.textContent = fallback
      ? "DEPTH ESTIMATED FROM IMAGE LIGHT · LOCAL FALLBACK"
      : "DEPTH READY · ALL IMAGE PROCESSING STAYS LOCAL";
    updateEmbed();
    if (fallback) showToast("Depth model unavailable; a light-based depth map is ready.");
  } catch (_error) {
    statusLine.textContent = "COULD NOT READ IMAGE";
    showToast("This browser could not decode that image.");
  } finally {
    if (bitmap) bitmap.close();
    picker.value = "";
  }
}

function escapeAttribute(value) {
  return String(value).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

function scriptUrl() {
  if (location.protocol === "file:" || /^(localhost|127\.0\.0\.1)$/.test(location.hostname)) {
    return "https://YOUR-VERCEL-DOMAIN/particle-cloud.js";
  }
  return new URL("./particle-cloud.js", location.href).href;
}

function updateEmbed() {
  if (!sourceImage || !depthImage) return;
  const code = [
    '<script type="module" src="' + scriptUrl() + '"></script>',
    '<particle-cloud',
    '  image="' + escapeAttribute(sourceImage) + '"',
    '  depth="' + escapeAttribute(depthImage) + '"',
    '  amplitude="' + (Number($("#depth-range").value) / 100).toFixed(2) + '"',
    '  drift="' + (Number($("#drift-range").value) / 100).toFixed(2) + '"',
    '  point-size="' + (Number($("#size-range").value) / 10).toFixed(1) + '"',
    '  tint="' + currentColor + '"',
    '  style="display:block;width:100%;height:420px">',
    '</particle-cloud>'
  ].join("\n");
  embedField.value = code;
}

function downloadStandalone() {
  if (!sourceImage || !depthImage) return;
  fetch("./particle-cloud.js")
    .then((response) => {
      if (!response.ok) throw new Error("Could not read the particle component.");
      return response.text();
    })
    .then((componentSource) => {
      const safeScript = componentSource.replace(/<\/script/gi, "<\\/script");
      const html = [
        "<!doctype html>",
        '<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">',
        "<title>" + escapeAttribute(sourceName) + " — Particle Element</title>",
        "<style>html,body{margin:0;width:100%;height:100%;background:#050505}particle-cloud{display:block;width:100vw;height:100vh}</style>",
        "</head><body>",
        '<script>' + safeScript + "<\/script>",
        '<particle-cloud image="' + escapeAttribute(sourceImage) + '"',
        ' depth="' + escapeAttribute(depthImage) + '"',
        ' amplitude="' + (Number($("#depth-range").value) / 100).toFixed(2) + '"',
        ' drift="' + (Number($("#drift-range").value) / 100).toFixed(2) + '"',
        ' point-size="' + (Number($("#size-range").value) / 10).toFixed(1) + '"',
        ' tint="' + currentColor + '"></particle-cloud>',
        "</body></html>"
      ].join("\n");
      const url = URL.createObjectURL(new Blob([html], { type: "text/html" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = (sourceName.replace(/\.[^.]+$/, "") || "particle-element") + ".html";
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      showToast("Standalone HTML downloaded.");
    })
    .catch(() => showToast("Could not create the standalone file."));
}

picker.addEventListener("change", () => handleFile(picker.files[0]));
$("#remove-image").addEventListener("click", () => {
  sourceImage = "";
  depthImage = "";
  sourceName = "";
  cloud.setData(null);
  $("#active-name").textContent = "NO IMAGE SELECTED";
  $("#point-count").textContent = "0 POINTS";
  $("#source-name").textContent = "";
  $("#source-dimensions").textContent = "";
  $("#thumb").style.backgroundImage = "";
  sourceRow.hidden = true;
  emptyState.hidden = false;
  copyButton.disabled = true;
  downloadButton.disabled = true;
  embedField.value = "";
  statusLine.textContent = "WAITING FOR YOUR FIRST PICTURE";
});
$("#depth-range").addEventListener("input", updateOptions);
$("#drift-range").addEventListener("input", updateOptions);
$("#size-range").addEventListener("input", updateOptions);

document.querySelectorAll(".swatch").forEach((button) => {
  button.addEventListener("click", () => {
    currentColor = button.dataset.color;
    document.querySelectorAll(".swatch").forEach((item) => item.classList.toggle("selected", item === button));
    $("#custom-color").value = currentColor;
    updateOptions();
  });
});
$("#custom-color").addEventListener("input", (event) => {
  currentColor = event.target.value;
  document.querySelectorAll(".swatch").forEach((item) => item.classList.remove("selected"));
  updateOptions();
});
$("#reset-view").addEventListener("click", () => cloud.resetView());
$("#fullscreen").addEventListener("click", () => {
  if (!document.fullscreenElement) document.querySelector(".workspace").requestFullscreen?.();
  else document.exitFullscreen?.();
});
$("#copy-embed").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(embedField.value);
    showToast("Embed code copied.");
  } catch (_error) {
    embedField.focus();
    embedField.select();
    showToast("Select the code and copy it.");
  }
});
$("#download-html").addEventListener("click", downloadStandalone);

dropZone.addEventListener("dragover", (event) => {
  event.preventDefault();
  dropZone.classList.add("dragging");
});
dropZone.addEventListener("dragleave", (event) => {
  if (!dropZone.contains(event.relatedTarget)) dropZone.classList.remove("dragging");
});
dropZone.addEventListener("drop", (event) => {
  event.preventDefault();
  dropZone.classList.remove("dragging");
  handleFile(event.dataTransfer.files[0]);
});

document.addEventListener("keydown", (event) => {
  if (event.target.matches("input,textarea,select,button")) return;
  if (event.key.toLowerCase() === "f") $("#fullscreen").click();
  if (event.key.toLowerCase() === "r") cloud.resetView();
});
cloud.addEventListener("points-ready", (event) => {
  $("#point-count").textContent = event.detail.count.toLocaleString() + " POINTS";
});
cloud.addEventListener("render-error", (event) => {
  statusLine.textContent = event.detail || "WEBGL COULD NOT START";
});

updateOptions();
