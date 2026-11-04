const $ = (selector) => document.querySelector(selector);
const picker = $("#file-picker");
const cloud = $("#cloud");
const dropZone = $("#drop-zone");
const emptyState = $("#empty-state");
const statusLine = $("#model-status");
const toast = $("#toast");
const sourceRow = $("#source-row");
const sourceGallery = $("#source-gallery");
const galleryNav = $("#gallery-nav");
const linePad = $("#line-pad");
const copyButton = $("#copy-embed");
const downloadButton = $("#download-html");
const embedField = $("#embed-code");
const MAX_FILE_BYTES = 25 * 1024 * 1024;
const MAX_GALLERY_SIZE = 4;
const MAX_IMAGE_SIDE = 520;
const MODEL_SIDE = 224;
const lineState = { x: 0, y: 0, angle: 1.72, side: -1 };

let sourceImage = "";
let depthImage = "";
let sourceName = "";
let imageGallery = [];
let activeImage = null;
let fileQueue = [];
let processingQueue = false;
let activationVersion = 0;
let lineDrag = null;
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

function updateOptions(updateSnippet = true) {
  const options = {
    amplitude: Number($("#depth-range").value) / 100,
    drift: Number($("#drift-range").value) / 100,
    splash: Number($("#splash-range").value) / 100,
    gather: Number($("#gather-range").value) / 100,
    pointSize: Number($("#size-range").value) / 10,
    tint: currentColor,
    track: cloudToggle("track"),
    links: cloudToggle("links"),
    scan: cloudToggle("scan"),
    trails: cloudToggle("trails"),
    marks: cloudToggle("marks"),
    density: cloudMode("density"),
    travel: cloudMode("travel"),
    paper: cloudMode("paper"),
    line: { ...lineState },
    negative: cloudMode("tone") === "negative"
  };
  $("#depth-value").value = $("#depth-range").value;
  $("#drift-value").value = $("#drift-range").value;
  $("#splash-value").value = $("#splash-range").value;
  $("#gather-value").value = $("#gather-range").value;
  $("#size-value").value = $("#size-range").value;
  updateLinePad();
  cloud.setOptions(options);
  if (sourceImage && updateSnippet) updateEmbed();
}

function updateLinePad() {
  const tx = Math.cos(lineState.angle);
  const ty = Math.sin(lineState.angle);
  const nx = -ty * lineState.side;
  const ny = tx * lineState.side;
  const x = lineState.x;
  const y = lineState.y;
  const stem = 0.2 + 0.45 * Number($("#drift-range").value) / 100;
  const attrs = (selector, values) => {
    const node = $(selector);
    Object.entries(values).forEach(([name, value]) => node.setAttribute(name, String(Number(value.toFixed(3)))));
  };
  attrs("#line-axis", { x1: x - 4 * tx, y1: -(y - 4 * ty), x2: x + 4 * tx, y2: -(y + 4 * ty) });
  attrs("#line-stem", { x1: x, y1: -y, x2: x + nx * stem, y2: -(y + ny * stem) });
  attrs("#line-tip", { cx: x + nx * stem, cy: -(y + ny * stem) });
  attrs("#line-end-a", { cx: x + 0.72 * tx, cy: -(y + 0.72 * ty) });
  attrs("#line-end-b", { cx: x - 0.72 * tx, cy: -(y - 0.72 * ty) });
  $("#line-side").setAttribute("transform", `matrix(${tx} ${-ty} ${nx} ${-ny} ${x} ${-y})`);
}

function linePadPoint(event) {
  const rect = linePad.getBoundingClientRect();
  return {
    x: (event.clientX - rect.left) / rect.width * 2.6 - 1.3,
    y: -((event.clientY - rect.top) / rect.height * 2.6 - 1.3)
  };
}

function applyLinePad(updateSnippet = true) {
  updateLinePad();
  updateOptions(updateSnippet);
}

function cloudToggle(name) {
  return document.querySelector(`[data-cloud-toggle="${name}"]`)?.getAttribute("aria-pressed") === "true";
}

function cloudMode(name) {
  return document.querySelector(`[data-cloud-mode="${name}"].active`)?.dataset.value || "";
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

async function makeSample() {
  await document.fonts.load('500 196px "Space Grotesk"').catch(() => []);
  const image = document.createElement("canvas");
  image.width = 1100;
  image.height = 440;
  const imageContext = image.getContext("2d");
  imageContext.fillStyle = "#ffe9c4";
  imageContext.font = '500 196px "Space Grotesk", sans-serif';
  imageContext.letterSpacing = "-7px";
  imageContext.textAlign = "center";
  imageContext.textBaseline = "middle";
  imageContext.fillText("vantaM.", image.width / 2, image.height / 2);
  imageContext.fillRect(400, 330, 300, 2);

  const depth = document.createElement("canvas");
  depth.width = image.width;
  depth.height = image.height;
  const depthContext = depth.getContext("2d");
  const gradient = depthContext.createLinearGradient(0, 0, depth.width, depth.height);
  gradient.addColorStop(0, "#303030");
  gradient.addColorStop(1, "#d0d0d0");
  depthContext.fillStyle = gradient;
  depthContext.fillRect(0, 0, depth.width, depth.height);
  return { image: image.toDataURL("image/png"), depth: depth.toDataURL("image/png") };
}

async function showSample() {
  emptyState.hidden = false;
  $("#active-name").textContent = "vantaM. · SAMPLE";
  $("#point-count").textContent = "LOADING SAMPLE";
  statusLine.textContent = "LIVE SAMPLE · ADD AN IMAGE TO MAKE IT YOURS";
  const sample = await makeSample();
  if (activeImage) return;
  await cloud.setData(sample);
  if (activeImage) return;
  updateOptions(false);
  $("#point-count").textContent = cloud.pointCount.toLocaleString() + " POINTS";
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

function renderGallery() {
  sourceGallery.replaceChildren();
  imageGallery.forEach((item, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "gallery-thumb" + (item === activeImage ? " active" : "");
    button.dataset.state = item.status;
    button.style.backgroundImage = `url("${item.image || item.previewUrl}")`;
    button.textContent = item.status === "ready" ? "" : item.status === "failed" ? "!" : "…";
    button.title = `${item.name} · ${item.status}`;
    button.setAttribute("aria-label", `Picture ${index + 1}: ${item.name}, ${item.status}`);
    button.setAttribute("aria-pressed", String(item === activeImage));
    button.addEventListener("click", () => activateImage(item));
    sourceGallery.append(button);
  });
  sourceGallery.hidden = imageGallery.length === 0;
  galleryNav.hidden = imageGallery.length < 2;
  const activeIndex = imageGallery.indexOf(activeImage);
  $("#gallery-index").textContent = `${String(Math.max(0, activeIndex) + 1).padStart(2, "0")} / ${String(imageGallery.length).padStart(2, "0")}`;
}

function activateImage(item) {
  if (!imageGallery.includes(item)) return;
  activeImage = item;
  const version = ++activationVersion;
  renderGallery();
  emptyState.hidden = true;

  if (item.status === "failed") {
    const displayed = imageGallery.find((entry) => entry !== item && entry.status === "ready" && entry.image === sourceImage);
    if (displayed) {
      activeImage = displayed;
      renderGallery();
      statusLine.textContent = displayed.fallback
        ? "DEPTH ESTIMATED FROM IMAGE LIGHT · LOCAL FALLBACK"
        : "DEPTH READY · ALL IMAGE PROCESSING STAYS LOCAL";
    } else {
      $("#active-name").textContent = item.name.toUpperCase();
      sourceRow.hidden = true;
      emptyState.hidden = false;
      copyButton.disabled = true;
      downloadButton.disabled = true;
      $("#point-count").textContent = "0 POINTS";
      statusLine.textContent = "COULD NOT READ IMAGE";
    }
    return;
  }
  if (item.status !== "ready") {
    if (!sourceImage) {
      $("#active-name").textContent = item.name.toUpperCase();
      sourceRow.hidden = true;
      emptyState.hidden = true;
      copyButton.disabled = true;
      downloadButton.disabled = true;
      $("#point-count").textContent = "PROCESSING";
    }
    statusLine.textContent = item.status === "depth" ? "LOADING DEPTH MODEL · IMAGE STAYS LOCAL" : "READING IMAGE · KEEP THIS TAB OPEN";
    return;
  }

  sourceImage = item.image;
  depthImage = item.depth;
  sourceName = item.name;
  $("#active-name").textContent = item.name.toUpperCase();
  $("#source-name").textContent = item.name;
  $("#source-dimensions").textContent = `${item.width} × ${item.height}`;
  $("#thumb").style.backgroundImage = `url("${sourceImage}")`;
  sourceRow.hidden = false;
  copyButton.disabled = true;
  downloadButton.disabled = true;
  statusLine.textContent = "TRANSFORMING PARTICLES";
  cloud.setData({ image: sourceImage, depth: depthImage }).then(() => {
    if (version !== activationVersion) return;
    updateOptions();
    $("#point-count").textContent = cloud.pointCount.toLocaleString() + " POINTS";
    statusLine.textContent = item.fallback
      ? "DEPTH ESTIMATED FROM IMAGE LIGHT · LOCAL FALLBACK"
      : "DEPTH READY · ALL IMAGE PROCESSING STAYS LOCAL";
    copyButton.disabled = false;
    downloadButton.disabled = false;
    updateEmbed();
  });
}

async function processQueue() {
  if (processingQueue) return;
  processingQueue = true;
  try {
    while (fileQueue.length) {
      const item = fileQueue.shift();
      if (!imageGallery.includes(item)) continue;
      item.status = "reading";
      renderGallery();
      if (activeImage === item) statusLine.textContent = "READING IMAGE · KEEP THIS TAB OPEN";
      let bitmap;
      try {
        bitmap = await decodeImage(item.file);
        if (!imageGallery.includes(item)) continue;
        const source = makeSource(bitmap);
        const model = makeModelInput(bitmap);
        item.image = source.data;
        item.width = bitmap.width;
        item.height = bitmap.height;
        item.status = "depth";
        renderGallery();
        if (activeImage === item) statusLine.textContent = "LOADING DEPTH MODEL · IMAGE STAYS LOCAL";

        let depthValues;
        try {
          depthValues = await inferDepth(model.tensor);
        } catch (_error) {
          // shortcut: luminance has no scene geometry; restore FastDepth when the runtime is reachable.
          depthValues = model.luma;
          item.fallback = true;
        }
        if (!imageGallery.includes(item)) continue;
        item.depth = makeDepth(depthValues, source.width, source.height, model);
        item.status = "ready";
        item.file = null;
        if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
        item.previewUrl = "";
        renderGallery();
        if (activeImage === item) {
          activateImage(item);
          if (item.fallback) showToast("Depth model unavailable; a light-based depth map is ready.");
        }
      } catch (_error) {
        if (!imageGallery.includes(item)) continue;
        item.status = "failed";
        item.file = null;
        if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
        item.previewUrl = "";
        renderGallery();
        if (activeImage === item) activateImage(item);
        showToast("This browser could not decode that image.");
      } finally {
        if (bitmap) bitmap.close();
      }
    }
  } finally {
    processingQueue = false;
  }
}

function handleFiles(files) {
  const selected = Array.from(files || []);
  if (!selected.length) return;
  const valid = selected.filter((file) => {
    if (file.type && !file.type.startsWith("image/")) {
      showToast("Choose image files only.");
      return false;
    }
    if (file.size > MAX_FILE_BYTES) {
      showToast(`${file.name} is over 25 MB.`);
      return false;
    }
    return true;
  });
  const available = MAX_GALLERY_SIZE - imageGallery.length;
  if (available <= 0) {
    showToast("Remove a picture before adding another.");
    picker.value = "";
    return;
  }
  if (valid.length > available) showToast(`Only ${available} more picture${available === 1 ? "" : "s"} fit in the gallery.`);
  const added = valid.slice(0, available).map((file) => ({
    file,
    name: file.name,
    previewUrl: URL.createObjectURL(file),
    status: "queued",
    image: "",
    depth: "",
    fallback: false
  }));
  imageGallery.push(...added);
  if (!activeImage && added[0]) activateImage(added[0]);
  else renderGallery();
  fileQueue.push(...added);
  picker.value = "";
  processQueue();
}

function clearActiveImage() {
  activationVersion++;
  activeImage = null;
  sourceImage = "";
  depthImage = "";
  sourceName = "";
  cloud.setData(null);
  $("#source-name").textContent = "";
  $("#source-dimensions").textContent = "";
  $("#thumb").style.backgroundImage = "";
  sourceRow.hidden = true;
  copyButton.disabled = true;
  downloadButton.disabled = true;
  embedField.value = "";
  showSample();
  renderGallery();
}

function removeActiveImage() {
  const index = imageGallery.indexOf(activeImage);
  if (index < 0) return;
  const [removed] = imageGallery.splice(index, 1);
  if (removed.previewUrl) URL.revokeObjectURL(removed.previewUrl);
  fileQueue = fileQueue.filter((item) => item !== removed);
  const next = imageGallery[index] || imageGallery[index - 1];
  if (next) activateImage(next);
  else clearActiveImage();
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
    '  splash="' + (Number($("#splash-range").value) / 100).toFixed(2) + '"',
    '  gather="' + (Number($("#gather-range").value) / 100).toFixed(2) + '"',
    '  point-size="' + (Number($("#size-range").value) / 10).toFixed(1) + '"',
    '  line-x="' + lineState.x.toFixed(3) + '" line-y="' + lineState.y.toFixed(3) + '"',
    '  line-angle="' + lineState.angle.toFixed(3) + '" line-side="' + lineState.side + '"',
    '  track="' + optionsValue("track") + '" links="' + optionsValue("links") + '"',
    '  scan="' + optionsValue("scan") + '" trails="' + optionsValue("trails") + '"',
    '  marks="' + optionsValue("marks") + '" density="' + cloudMode("density") + '"',
    '  travel="' + cloudMode("travel") + '"',
    '  paper="' + cloudMode("paper") + '" negative="' + optionsValue("negative") + '"',
    '  tint="' + currentColor + '"',
    '  style="display:block;width:100%;height:420px">',
    '</particle-cloud>'
  ].join("\n");
  embedField.value = code;
}

function optionsValue(name) {
  const value = name === "negative" ? cloudMode("tone") === "negative" : cloudToggle(name);
  return String(value);
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
        "<title>" + escapeAttribute(sourceName) + " | Particle Element</title>",
        "<style>html,body{margin:0;width:100%;height:100%;background:#050505}particle-cloud{display:block;width:100vw;height:100vh}</style>",
        "</head><body>",
        '<script>' + safeScript + "<\/script>",
        '<particle-cloud image="' + escapeAttribute(sourceImage) + '"',
        ' depth="' + escapeAttribute(depthImage) + '"',
        ' amplitude="' + (Number($("#depth-range").value) / 100).toFixed(2) + '"',
        ' drift="' + (Number($("#drift-range").value) / 100).toFixed(2) + '"',
        ' splash="' + (Number($("#splash-range").value) / 100).toFixed(2) + '"',
        ' gather="' + (Number($("#gather-range").value) / 100).toFixed(2) + '"',
        ' point-size="' + (Number($("#size-range").value) / 10).toFixed(1) + '"',
        ' line-x="' + lineState.x.toFixed(3) + '" line-y="' + lineState.y.toFixed(3) + '"',
        ' line-angle="' + lineState.angle.toFixed(3) + '" line-side="' + lineState.side + '"',
        ' track="' + optionsValue("track") + '" links="' + optionsValue("links") + '"',
        ' scan="' + optionsValue("scan") + '" trails="' + optionsValue("trails") + '"',
        ' marks="' + optionsValue("marks") + '" density="' + cloudMode("density") + '"',
        ' travel="' + cloudMode("travel") + '"',
        ' paper="' + cloudMode("paper") + '" negative="' + optionsValue("negative") + '"',
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

picker.addEventListener("change", () => handleFiles(picker.files));
$("#remove-image").addEventListener("click", removeActiveImage);
$("#gallery-prev").addEventListener("click", () => {
  const index = imageGallery.indexOf(activeImage);
  if (index >= 0 && imageGallery.length > 1) activateImage(imageGallery[(index + imageGallery.length - 1) % imageGallery.length]);
});
$("#gallery-next").addEventListener("click", () => {
  const index = imageGallery.indexOf(activeImage);
  if (index >= 0 && imageGallery.length > 1) activateImage(imageGallery[(index + 1) % imageGallery.length]);
});
$("#depth-range").addEventListener("input", updateOptions);
$("#drift-range").addEventListener("input", updateOptions);
$("#splash-range").addEventListener("input", updateOptions);
$("#gather-range").addEventListener("input", updateOptions);
$("#size-range").addEventListener("input", updateOptions);
linePad.addEventListener("pointerdown", (event) => {
  const point = linePadPoint(event);
  const dx = point.x - lineState.x;
  const dy = point.y - lineState.y;
  const tx = Math.cos(lineState.angle);
  const ty = Math.sin(lineState.angle);
  const along = dx * tx + dy * ty;
  const across = -dx * ty + dy * tx;
  if (Math.abs(across) > 0.24) {
    lineState.side = across < 0 ? -1 : 1;
    applyLinePad();
    return;
  }
  lineDrag = { kind: Math.abs(along) > 0.42 ? "turn" : "move", point, x: lineState.x, y: lineState.y };
  linePad.setPointerCapture(event.pointerId);
  event.preventDefault();
});
linePad.addEventListener("pointermove", (event) => {
  if (!lineDrag) return;
  const point = linePadPoint(event);
  if (lineDrag.kind === "move") {
    lineState.x = Math.max(-1.1, Math.min(1.1, lineDrag.x + point.x - lineDrag.point.x));
    lineState.y = Math.max(-1.1, Math.min(1.1, lineDrag.y + point.y - lineDrag.point.y));
  } else if (Math.hypot(point.x - lineState.x, point.y - lineState.y) > 0.08) {
    lineState.angle = Math.atan2(point.y - lineState.y, point.x - lineState.x);
  }
  applyLinePad(false);
});
linePad.addEventListener("pointerup", () => { lineDrag = null; updateOptions(); });
linePad.addEventListener("pointercancel", () => { lineDrag = null; updateOptions(); });
linePad.addEventListener("keydown", (event) => {
  const amount = event.shiftKey ? 3 : 1;
  if (event.key === "ArrowLeft") lineState.angle += 0.05 * amount;
  else if (event.key === "ArrowRight") lineState.angle -= 0.05 * amount;
  else if (event.key === "ArrowUp" || event.key === "ArrowDown") {
    const offset = (event.key === "ArrowUp" ? 0.04 : -0.04) * amount * lineState.side;
    lineState.x -= Math.sin(lineState.angle) * offset;
    lineState.y += Math.cos(lineState.angle) * offset;
  } else if (event.key.toLowerCase() === "f") lineState.side *= -1;
  else return;
  event.preventDefault();
  event.stopPropagation();
  applyLinePad();
});

document.querySelectorAll(".swatch").forEach((button) => {
  button.addEventListener("click", () => {
    currentColor = button.dataset.color;
    document.querySelectorAll(".swatch").forEach((item) => item.classList.toggle("selected", item === button));
    $("#custom-color").value = currentColor;
    updateOptions();
  });
});
document.querySelectorAll("[data-cloud-toggle]").forEach((button) => {
  button.addEventListener("click", () => {
    const pressed = button.getAttribute("aria-pressed") !== "true";
    button.setAttribute("aria-pressed", String(pressed));
    button.classList.toggle("active", pressed);
    button.blur();
    updateOptions();
  });
});
document.querySelectorAll("[data-cloud-mode]").forEach((button) => {
  button.addEventListener("click", () => {
    const group = button.dataset.cloudMode;
    document.querySelectorAll(`[data-cloud-mode="${group}"]`).forEach((item) => {
      const selected = item === button;
      item.classList.toggle("active", selected);
      item.setAttribute("aria-pressed", String(selected));
    });
    button.blur();
    updateOptions();
  });
});
$("#custom-color").addEventListener("input", (event) => {
  currentColor = event.target.value;
  document.querySelectorAll(".swatch").forEach((item) => item.classList.remove("selected"));
  updateOptions();
});
$("#reset-view").addEventListener("click", () => cloud.resetView());
$("#light-burst").addEventListener("click", (event) => { cloud.triggerLight(); event.currentTarget.blur(); });
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
  handleFiles(event.dataTransfer.files);
});

document.addEventListener("keydown", (event) => {
  if (event.target.matches("input,textarea,select,button")) return;
  const key = event.key.toLowerCase();
  if (key === " " && imageGallery.length > 1 && !event.repeat) {
    event.preventDefault();
    $("#gallery-next").click();
  }
  if (key === "f") $("#fullscreen").click();
  if (key === "r") cloud.resetView();
  if (key === "s") cloud.triggerLight();
  if (key === "h") document.body.classList.toggle("hide-ui");
  if (key === "m") {
    const next = cloudMode("travel") === "swarm" ? "melt" : "swarm";
    document.querySelector(`[data-cloud-mode="travel"][data-value="${next}"]`).click();
  }
  if (key === "b") {
    const next = cloudMode("paper") === "dark" ? "light" : "dark";
    document.querySelector(`[data-cloud-mode="paper"][data-value="${next}"]`).click();
  }
});
cloud.addEventListener("points-ready", (event) => {
  $("#point-count").textContent = event.detail.count.toLocaleString() + " POINTS";
});
cloud.addEventListener("render-error", (event) => {
  statusLine.textContent = event.detail || "WEBGL COULD NOT START";
});

updateOptions();
showSample();
