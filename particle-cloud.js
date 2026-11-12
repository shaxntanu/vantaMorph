const vertexSource = [
  "attribute vec3 a_position;",
  "attribute vec3 a_position_from;",
  "attribute vec4 a_color;",
  "attribute vec4 a_color_from;",
  "uniform vec2 u_fit;",
  "uniform vec2 u_rotation;",
  "uniform float u_zoom;",
  "uniform float u_amplitude;",
  "uniform float u_time;",
  "uniform float u_point_size;",
  "uniform float u_morph;",
  "uniform vec3 u_tint;",
  "uniform vec4 u_brush[6];",
  "uniform vec4 u_lamp[3];",
  "uniform vec2 u_scan;",
  "uniform float u_aspect;",
  "uniform float u_negative;",
  "uniform vec3 u_lamp_color;",
  "uniform vec4 u_line;",
  "uniform vec3 u_wind;",
  "varying vec4 v_color;",
  "void main() {",
  "  float cx = cos(u_rotation.x), sx = sin(u_rotation.x);",
  "  float cy = cos(u_rotation.y), sy = sin(u_rotation.y);",
  "  vec3 position = mix(a_position_from, a_position, u_morph);",
  "  vec4 sourceColor = mix(a_color_from, a_color, u_morph);",
  "  float r1 = fract(sin(dot(position.xy, vec2(12.9898, 78.233))) * 43758.5453);",
  "  float r2 = fract(sin(dot(position.yx, vec2(39.3468, 11.135))) * 24634.6345);",
  "  float r3 = fract(sin(dot(position.xy, vec2(93.9898, 67.345))) * 24634.6345);",
  "  float r4 = fract(sin(dot(position.yx, vec2(73.156, 52.235))) * 45624.123);",
  "  float r5 = fract(sin(dot(position.xy, vec2(47.131, 19.117))) * 31243.123);",
  "  float along = dot(position.xy - u_line.xy, vec2(-u_line.w, u_line.z));",
  "  float ragged = 0.11 * sin(along * 3.1 + u_time * 0.13) + 0.06 * sin(along * 7.7 - u_time * 0.09 + 1.7) + (r5 - 0.5) * 0.34;",
  "  float away = smoothstep(0.0, 1.15, dot(position.xy - u_line.xy, u_line.zw) + ragged) * step(0.004, u_wind.z);",
  "  float alive = 1.0;",
  "  if (away > 0.0) {",
  "    float per = 3.5 + 5.5 * r1;",
  "    float phase = fract((u_time - 0.26 * 0.26) / per + r2);",
  "    float hold = mix(0.82, 0.06, away);",
  "    float gone = max(0.0, (phase - hold) / (1.0 - hold));",
  "    float tr = gone * sqrt(gone);",
  "    float reach = u_wind.z * 1.8 * away * (0.55 + 0.9 * r3);",
  "    position.xy += u_wind.xy * reach * tr;",
  "    position.xy += vec2(sin(along * 3.0 + u_time), cos(along * 2.4 - u_time)) * reach * tr * 0.04;",
  "    position.z += (r4 - 0.5) * tr * reach * 0.6;",
  "    alive = mix(1.0, smoothstep(0.0, 0.07, phase) * (1.0 - smoothstep(0.3, 1.0, gone)), smoothstep(0.0, 0.3, away));",
  "  }",
  "  float px = position.x;",
  "  float py = position.y;",
  "  float pz = position.z * u_amplitude;",
  "  float rx = cy * px + sy * pz;",
  "  float rz = -sy * px + cy * pz;",
  "  float ry = cx * py - sx * rz;",
  "  float perspective = 1.0 - rz * 0.14;",
  "  vec2 screen = vec2(rx * u_fit.x * u_zoom / perspective, ry * u_fit.y * u_zoom / perspective);",
  "  vec2 push = vec2(0.0);",
  "  for (int b = 0; b < 6; b++) {",
  "    vec2 d = (screen - u_brush[b].xy) * vec2(u_aspect, 1.0);",
  "    vec2 w = u_brush[b].zw;",
  "    push += (w + vec2(-w.y, w.x) * (r2 - 0.5) * 1.3) * exp(-dot(d, d) * 22.0) * (0.45 + 1.1 * r1);",
  "  }",
  "  screen += push / vec2(u_aspect, 1.0);",
  "  float band = u_scan.y * exp(-pow((pz - u_scan.x) / 0.02, 2.0));",
  "  float lit = 0.0;",
  "  for (int k = 0; k < 3; k++) { vec3 d = position - u_lamp[k].xyz; lit += u_lamp[k].w / (1.0 + dot(d, d) * 3.2); }",
  "  vec3 color = sourceColor.rgb * u_tint;",
  "  if (u_negative > 0.5) color = 1.0 - color;",
  "  color = min(color * (1.0 + 0.55 * band) + u_lamp_color * lit * 0.3, 1.0);",
  "  gl_Position = vec4(screen, rz * 0.08, 1.0);",
  "  gl_PointSize = u_point_size * (1.0 + 0.35 * band + 0.25 * min(1.0, lit));",
  "  v_color = vec4(color, sourceColor.a * alive);",
  "}"
].join("\n");

const fragmentSource = [
  "precision mediump float;",
  "varying vec4 v_color;",
  "void main() {",
  "  vec2 d = gl_PointCoord - vec2(0.5);",
  "  if (dot(d, d) > 0.25) discard;",
  "  gl_FragColor = v_color;",
  "}"
].join("\n");

const DEFAULT_ROTATION = [0.14, -0.16];

function shortestAngle(from, to) {
  const turn = Math.PI * 2;
  return ((to - from + Math.PI) % turn + turn) % turn - Math.PI;
}

function makeImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Could not decode this image."));
    img.src = src;
  });
}

class ParticleCloud extends HTMLElement {
  static get observedAttributes() {
    return ["image", "depth", "amplitude", "drift", "splash", "gather", "line-x", "line-y", "line-angle", "line-side", "point-size", "tint", "track", "links", "scan", "trails", "marks", "density", "paper", "negative", "travel"];
  }

  constructor() {
    super();
    this._options = {
      amplitude: 0.2, drift: 0.04, splash: 0.25, gather: 0.85, pointSize: 2, tint: "#ffe9c4",
      track: true, links: true, scan: false, trails: false, marks: true,
      density: "sparse", paper: "dark", negative: true, travel: "swarm",
      line: { x: 0, y: 0, angle: 1.72, side: -1 }
    };
    this._rotation = [...DEFAULT_ROTATION];
    this._zoom = 1;
    this._viewReset = null;
    this._timeStart = performance.now();
    this._frame = 0;
    this._version = 0;
    this._count = 0;
    this._drag = null;
    this._brush = [];
    this._lastPointer = null;
    this._lights = [];
    this._trackerIndices = [];
    this._trailIndices = [];
    this._trailPositions = new Map();
    this.attachShadow({ mode: "open" });
  }

  connectedCallback() {
    this.shadowRoot.innerHTML = [
      "<style>",
      ":host{display:block;position:relative;width:100%;height:100%;outline:none}",
      "canvas{display:block;width:100%;height:100%}",
      "canvas[part='canvas']{position:absolute;inset:0;z-index:0;touch-action:none;cursor:crosshair}",
      "canvas[part='canvas'].drag{cursor:grabbing}",
      ".trails,.hud{position:absolute;inset:0;pointer-events:none}",
      ".trails{z-index:1}",
      ".hud{z-index:2}",
      ".fallback{position:absolute;inset:0;z-index:3;width:100%;height:100%;object-fit:contain;background:#050505}",
      "</style>",
      "<canvas part='canvas' role='img' aria-label='Moving particle image' tabindex='0'></canvas>",
      "<canvas class='trails' aria-hidden='true'></canvas>",
      "<canvas class='hud' aria-hidden='true'></canvas>",
      "<img class='fallback' alt='' hidden>"
    ].join("");
    this.canvas = this.shadowRoot.querySelector("canvas");
    this.trails = this.shadowRoot.querySelector(".trails");
    this.hud = this.shadowRoot.querySelector(".hud");
    this.trailContext = this.trails.getContext("2d");
    this.hudContext = this.hud.getContext("2d");
    this.fallback = this.shadowRoot.querySelector(".fallback");
    this.gl = this.canvas.getContext("webgl", { alpha: false, antialias: true, powerPreference: "high-performance" });
    if (!this.gl) {
      this._showFallback();
      this.dispatchEvent(new CustomEvent("render-error", { bubbles: true, detail: "WebGL is unavailable in this browser." }));
      return;
    }
    this._initGL();
    this._readAttributes();
    this._observer = new ResizeObserver(() => this._resize());
    this._observer.observe(this);
    this._resize();
    this._bindControls();
    this._loop();
  }

  disconnectedCallback() {
    cancelAnimationFrame(this._frame);
    if (this._observer) this._observer.disconnect();
  }

  attributeChangedCallback(name, _oldValue, newValue) {
    if (!this.isConnected || _oldValue === newValue) return;
    if (name === "image" || name === "depth") {
      this._readAttributes();
      return;
    }
    if (name === "amplitude") this._options.amplitude = Number(newValue) || 0;
    if (name === "drift") this._options.drift = Number(newValue) || 0;
    if (name === "splash") this._options.splash = Number(newValue) || 0;
    if (name === "gather") this._options.gather = Number(newValue) || 0;
    if (name === "line-x") this._options.line.x = Number(newValue) || 0;
    if (name === "line-y") this._options.line.y = Number(newValue) || 0;
    if (name === "line-angle") this._options.line.angle = Number(newValue) || 0;
    if (name === "line-side") this._options.line.side = Number(newValue) < 0 ? -1 : 1;
    if (name === "point-size") this._options.pointSize = Number(newValue) || 1;
    if (name === "tint") this._options.tint = newValue || "#ffe9c4";
    if (["track", "links", "scan", "trails", "marks", "negative"].includes(name)) this._options[name] = newValue !== "false";
    if (name === "paper") this._options.paper = newValue === "light" ? "light" : "dark";
    if (name === "density") {
      this._options.density = newValue === "dense" ? "dense" : "sparse";
      if (this._imageSource && this._depthSource) this._loadData();
    }
    if (name === "travel") this._options.travel = newValue === "melt" ? "melt" : "swarm";
  }

  get pointCount() {
    return this._count;
  }

  setData(data) {
    if (!data || !data.image || !data.depth) {
      this._version++;
      this._imageSource = "";
      this._depthSource = "";
      this._count = 0;
      this.positions = null;
      this.colors = null;
      this.positionsFrom = null;
      this.colorsFrom = null;
      this._transition = null;
      this._uploadedVersion = -1;
      this._brush.length = 0;
      this._lastPointer = null;
      this._lights.length = 0;
      this._trackerIndices = [];
      this._trailIndices = [];
      this._trailPositions.clear();
      this._draw();
      return Promise.resolve();
    }
    this._imageSource = data.image;
    this._depthSource = data.depth;
    return this._loadData();
  }

  setOptions(options) {
    const densityChanged = options && options.density && options.density !== this._options.density;
    Object.assign(this._options, options || {});
    if (densityChanged && this._imageSource && this._depthSource) this._loadData();
  }

  triggerLight() {
    const time = (performance.now() - this._timeStart) / 1000;
    this._lights.push({
      x: Math.random() * 1.7 - 0.85,
      y: Math.random() * 2.1 - 0.85,
      z: Math.random() * 1.6 - 0.8,
      time
    });
    if (this._lights.length > 3) this._lights.shift();
  }

  resetView() {
    this._viewReset = {
      start: performance.now(),
      fromRotation: [...this._rotation],
      toRotation: this._rotation.map((angle, index) => angle + shortestAngle(angle, DEFAULT_ROTATION[index])),
      fromZoom: this._zoom
    };
  }

  _readAttributes() {
    this._imageSource = this.getAttribute("image") || "";
    this._depthSource = this.getAttribute("depth") || "";
    this._options.amplitude = Number(this.getAttribute("amplitude") ?? 0.2);
    this._options.drift = Number(this.getAttribute("drift") ?? 0.04);
    this._options.splash = Number(this.getAttribute("splash") ?? 0.25);
    this._options.gather = Number(this.getAttribute("gather") ?? 0.85);
    this._options.pointSize = Number(this.getAttribute("point-size") ?? 2);
    this._options.tint = this.getAttribute("tint") || "#ffe9c4";
    this._options.line = {
      x: Number(this.getAttribute("line-x") ?? 0),
      y: Number(this.getAttribute("line-y") ?? 0),
      angle: Number(this.getAttribute("line-angle") ?? 1.72),
      side: Number(this.getAttribute("line-side") ?? -1) < 0 ? -1 : 1
    };
    for (const name of ["track", "links", "scan", "trails", "marks", "negative"]) {
      this._options[name] = this.getAttribute(name) !== "false";
    }
    this._options.density = this.getAttribute("density") === "dense" ? "dense" : "sparse";
    this._options.paper = this.getAttribute("paper") === "light" ? "light" : "dark";
    this._options.travel = this.getAttribute("travel") === "melt" ? "melt" : "swarm";
    if (this._imageSource && this._depthSource) this._loadData();
  }

  _initGL() {
    const gl = this.gl;
    const compile = (type, source) => {
      const shader = gl.createShader(type);
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        throw new Error(gl.getShaderInfoLog(shader) || "Could not compile the particle shader.");
      }
      return shader;
    };
    const program = gl.createProgram();
    gl.attachShader(program, compile(gl.VERTEX_SHADER, vertexSource));
    gl.attachShader(program, compile(gl.FRAGMENT_SHADER, fragmentSource));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error(gl.getProgramInfoLog(program) || "Could not link the particle shader.");
    }
    this.program = program;
    this.positionBuffer = gl.createBuffer();
    this.positionFromBuffer = gl.createBuffer();
    this.colorBuffer = gl.createBuffer();
    this.colorFromBuffer = gl.createBuffer();
    this.locations = {
      position: gl.getAttribLocation(program, "a_position"),
      positionFrom: gl.getAttribLocation(program, "a_position_from"),
      color: gl.getAttribLocation(program, "a_color"),
      colorFrom: gl.getAttribLocation(program, "a_color_from"),
      fit: gl.getUniformLocation(program, "u_fit"),
      rotation: gl.getUniformLocation(program, "u_rotation"),
      zoom: gl.getUniformLocation(program, "u_zoom"),
      amplitude: gl.getUniformLocation(program, "u_amplitude"),
      time: gl.getUniformLocation(program, "u_time"),
      pointSize: gl.getUniformLocation(program, "u_point_size"),
      morph: gl.getUniformLocation(program, "u_morph"),
      tint: gl.getUniformLocation(program, "u_tint"),
      brush: gl.getUniformLocation(program, "u_brush[0]"),
      lamps: gl.getUniformLocation(program, "u_lamp[0]"),
      scan: gl.getUniformLocation(program, "u_scan"),
      aspect: gl.getUniformLocation(program, "u_aspect"),
      negative: gl.getUniformLocation(program, "u_negative"),
      lampColor: gl.getUniformLocation(program, "u_lamp_color"),
      line: gl.getUniformLocation(program, "u_line"),
      wind: gl.getUniformLocation(program, "u_wind")
    };
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  }

  _bindControls() {
    this.canvas.addEventListener("pointerdown", (event) => {
      this._viewReset = null;
      this._drag = { x: event.clientX, y: event.clientY };
      this.canvas.classList.add("drag");
      this.canvas.setPointerCapture(event.pointerId);
    });
    this.canvas.addEventListener("pointermove", (event) => {
      if (!this._drag) {
        this._recordPointer(event);
        return;
      }
      const dx = event.clientX - this._drag.x;
      const dy = event.clientY - this._drag.y;
      this._rotation[1] += dx * 0.008;
      this._rotation[0] += dy * 0.008;
      this._drag = { x: event.clientX, y: event.clientY };
    });
    const stopDrag = () => { this._drag = null; this.canvas.classList.remove("drag"); };
    this.canvas.addEventListener("pointerup", stopDrag);
    this.canvas.addEventListener("pointercancel", stopDrag);
    this.canvas.addEventListener("dblclick", () => this.resetView());
    this.canvas.addEventListener("wheel", (event) => {
      event.preventDefault();
      this._viewReset = null;
      this._zoom = Math.min(1.9, Math.max(0.58, this._zoom - event.deltaY * 0.001));
    }, { passive: false });
    this.canvas.addEventListener("keydown", (event) => {
      if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "+", "=", "-"].includes(event.key)) this._viewReset = null;
      const amount = event.shiftKey ? 0.12 : 0.05;
      if (event.key === "ArrowLeft") this._rotation[1] -= amount;
      if (event.key === "ArrowRight") this._rotation[1] += amount;
      if (event.key === "ArrowUp") this._rotation[0] -= amount;
      if (event.key === "ArrowDown") this._rotation[0] += amount;
      if (event.key === "+" || event.key === "=") this._zoom = Math.min(1.9, this._zoom + 0.08);
      if (event.key === "-") this._zoom = Math.max(0.58, this._zoom - 0.08);
      if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "+", "=", "-"].includes(event.key)) event.preventDefault();
    });
  }

  async _loadData() {
    const version = ++this._version;
    if (!this._imageSource || !this._depthSource || !this.gl) return;
    const previousPositions = this.positions;
    const previousColors = this.colors;
    const previousCount = this._count;
    try {
      const pair = await Promise.all([makeImage(this._imageSource), makeImage(this._depthSource)]);
      if (version !== this._version) return;
      const image = pair[0];
      const width = image.naturalWidth;
      const height = image.naturalHeight;
      const source = document.createElement("canvas");
      source.width = width;
      source.height = height;
      const sourceCtx = source.getContext("2d", { willReadFrequently: true });
      sourceCtx.drawImage(image, 0, 0, width, height);
      const depthCanvas = document.createElement("canvas");
      depthCanvas.width = width;
      depthCanvas.height = height;
      const depthCtx = depthCanvas.getContext("2d", { willReadFrequently: true });
      depthCtx.drawImage(pair[1], 0, 0, width, height);
      const imageData = sourceCtx.getImageData(0, 0, width, height).data;
      const depthData = depthCtx.getImageData(0, 0, width, height).data;
      const particleLimit = this._options.density === "dense" ? 180000 : 70000;
      const step = Math.max(1, Math.ceil(Math.sqrt(width * height / particleLimit)));
      const maxCount = Math.ceil(width / step) * Math.ceil(height / step);
      const positions = new Float32Array(maxCount * 3);
      const colors = new Uint8Array(maxCount * 4);
      let count = 0;
      for (let y = 0; y < height; y += step) {
        for (let x = 0; x < width; x += step) {
          const sourceIndex = (y * width + x) * 4;
          const alpha = imageData[sourceIndex + 3];
          if (alpha < 12) continue;
          const i = count * 3;
          const color = count * 4;
          const depth = depthData[sourceIndex] / 255;
          positions[i] = (x / Math.max(1, width - 1) - 0.5) * 2;
          positions[i + 1] = (0.5 - y / Math.max(1, height - 1)) * 2;
          positions[i + 2] = (depth - 0.5) * 2;
          colors[color] = imageData[sourceIndex];
          colors[color + 1] = imageData[sourceIndex + 1];
          colors[color + 2] = imageData[sourceIndex + 2];
          colors[color + 3] = alpha;
          count++;
        }
      }
      this._width = width;
      this._height = height;
      this._count = count;
      this.positions = positions.subarray(0, count * 3);
      this.colors = colors.subarray(0, count * 4);
      this._buildTransition(previousPositions, previousColors, previousCount);
      this._selectTrackers();
      this._trailIndices = [];
      const trailStep = Math.max(1, Math.floor(count / 180));
      for (let i = 0; i < count; i += trailStep) this._trailIndices.push(i);
      this._trailPositions.clear();
      this._uploadedVersion = -1;
      this._draw();
      this.dispatchEvent(new CustomEvent("points-ready", { bubbles: true, detail: { count } }));
    } catch (error) {
      this.dispatchEvent(new CustomEvent("render-error", { bubbles: true, detail: error.message || String(error) }));
    }
  }

  _buildTransition(previousPositions, previousColors, previousCount) {
    this.positionsFrom = new Float32Array(this.positions.length);
    this.colorsFrom = new Uint8Array(this.colors.length);
    if (!previousPositions || !previousColors || !previousCount) {
      this.positionsFrom.set(this.positions);
      this.colorsFrom.set(this.colors);
      this._transition = null;
      return;
    }
    const buckets = new Map();
    if (this._options.travel === "melt") {
      for (let i = 0; i < previousCount; i++) {
        const p = i * 3;
        const x = Math.max(0, Math.min(63, Math.floor((previousPositions[p] + 1) * 32)));
        const y = Math.max(0, Math.min(63, Math.floor((previousPositions[p + 1] + 1) * 32)));
        const key = y * 64 + x;
        if (!buckets.has(key)) buckets.set(key, []);
        buckets.get(key).push(i);
      }
    }
    for (let i = 0; i < this._count; i++) {
      const p = i * 3;
      let fromIndex = Math.imul(i + 1, 2654435761) >>> 0;
      fromIndex %= previousCount;
      if (this._options.travel === "melt") {
        const gx = Math.max(0, Math.min(63, Math.floor((this.positions[p] + 1) * 32)));
        const gy = Math.max(0, Math.min(63, Math.floor((this.positions[p + 1] + 1) * 32)));
        let bestDistance = Infinity;
        let bestIndex = -1;
        for (let radius = 0; radius <= 3; radius++) {
          for (let y = Math.max(0, gy - radius); y <= Math.min(63, gy + radius); y++) {
            for (let x = Math.max(0, gx - radius); x <= Math.min(63, gx + radius); x++) {
              const candidates = buckets.get(y * 64 + x) || [];
              for (const candidate of candidates) {
                const old = candidate * 3;
                const dx = previousPositions[old] - this.positions[p];
                const dy = previousPositions[old + 1] - this.positions[p + 1];
                const distance = dx * dx + dy * dy;
                if (distance < bestDistance) { bestDistance = distance; bestIndex = candidate; }
              }
            }
          }
          if (bestIndex >= 0 && bestDistance < (radius / 32) ** 2) break;
        }
        if (bestIndex >= 0) fromIndex = bestIndex;
      }
      const oldPosition = fromIndex * 3;
      const oldColor = fromIndex * 4;
      this.positionsFrom.set(previousPositions.subarray(oldPosition, oldPosition + 3), p);
      this.colorsFrom.set(previousColors.subarray(oldColor, oldColor + 4), i * 4);
    }
    const gather = Math.max(0, Math.min(1, Number(this._options.gather) || 0));
    this._transition = { start: performance.now(), duration: 150 + (1 - gather) * 4050 };
  }

  _showFallback() {
    const src = this._imageSource || this.getAttribute("image");
    if (src && this.fallback) {
      this.fallback.src = src;
      this.fallback.hidden = false;
    }
  }

  _resize() {
    if (!this.gl || !this.canvas) return;
    const ratio = Math.min(2, window.devicePixelRatio || 1);
    const width = Math.max(1, Math.floor(this.clientWidth * ratio));
    const height = Math.max(1, Math.floor(this.clientHeight * ratio));
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
      this.gl.viewport(0, 0, width, height);
    }
    if (this.trails.width !== width || this.trails.height !== height) {
      this.trails.width = width;
      this.trails.height = height;
    }
    if (this.hud.width !== width || this.hud.height !== height) {
      this.hud.width = width;
      this.hud.height = height;
    }
  }

  _draw() {
    if (!this.gl || !this.program) return;
    const gl = this.gl;
    this._resize();
    const time = (performance.now() - this._timeStart) / 1000;
    const lightPaper = this._options.paper === "light";
    const paper = lightPaper ? 0.96 : 0.015;
    gl.clearColor(paper, paper, lightPaper ? 0.945 : paper, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    if (!this._count || !this.positions || !this.colors) {
      this._drawHud(time, 1, 1, this.canvas.width / Math.max(1, this.canvas.height));
      return;
    }
    gl.useProgram(this.program);
    if (this._uploadedVersion !== this._version) {
      gl.bindBuffer(gl.ARRAY_BUFFER, this.positionBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, this.positions, gl.STATIC_DRAW);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.positionFromBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, this.positionsFrom, gl.STATIC_DRAW);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.colorBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, this.colors, gl.STATIC_DRAW);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.colorFromBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, this.colorsFrom, gl.STATIC_DRAW);
      this._uploadedVersion = this._version;
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, this.positionBuffer);
    gl.enableVertexAttribArray(this.locations.position);
    gl.vertexAttribPointer(this.locations.position, 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.positionFromBuffer);
    gl.enableVertexAttribArray(this.locations.positionFrom);
    gl.vertexAttribPointer(this.locations.positionFrom, 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.colorBuffer);
    gl.enableVertexAttribArray(this.locations.color);
    gl.vertexAttribPointer(this.locations.color, 4, gl.UNSIGNED_BYTE, true, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.colorFromBuffer);
    gl.enableVertexAttribArray(this.locations.colorFrom);
    gl.vertexAttribPointer(this.locations.colorFrom, 4, gl.UNSIGNED_BYTE, true, 0, 0);

    const aspect = this.canvas.width / this.canvas.height;
    const imageAspect = this._width / this._height;
    const fitX = imageAspect > aspect ? 1 : imageAspect / aspect;
    const fitY = imageAspect > aspect ? aspect / imageAspect : 1;
    const tint = this._hexToRgb(this._options.tint);
    const ratio = Math.min(2, window.devicePixelRatio || 1);
    gl.uniform2f(this.locations.fit, fitX, fitY);
    gl.uniform2f(this.locations.rotation, this._rotation[0], this._rotation[1]);
    gl.uniform1f(this.locations.zoom, this._zoom);
    gl.uniform1f(this.locations.amplitude, Number(this._options.amplitude) || 0);
    gl.uniform1f(this.locations.time, time);
    let morph = 1;
    if (this._transition) {
      const progress = Math.min(1, (performance.now() - this._transition.start) / this._transition.duration);
      morph = progress * progress * (3 - 2 * progress);
      if (progress >= 1) this._transition = null;
    }
    gl.uniform1f(this.locations.morph, morph);
    gl.uniform1f(this.locations.pointSize, Math.max(1, Number(this._options.pointSize) * ratio));
    gl.uniform3f(this.locations.tint, tint[0], tint[1], tint[2]);
    gl.uniform4fv(this.locations.brush, this._brushUniforms(time));
    gl.uniform4fv(this.locations.lamps, this._lampUniforms(time));
    const line = this._options.line;
    const nx = -Math.sin(line.angle) * line.side;
    const ny = Math.cos(line.angle) * line.side;
    gl.uniform4f(this.locations.line, line.x, line.y, nx, ny);
    gl.uniform3f(this.locations.wind, nx, ny, 1.5 * (Number(this._options.drift) || 0));
    gl.uniform2f(this.locations.scan, ...this._scan(time));
    gl.uniform1f(this.locations.aspect, aspect);
    gl.uniform1f(this.locations.negative, lightPaper && this._options.negative ? 1 : 0);
    gl.uniform3f(this.locations.lampColor, tint[0], tint[1], tint[2]);
    gl.drawArrays(gl.POINTS, 0, this._count);
    this._drawHud(time, fitX, fitY, aspect);
  }

  _recordPointer(event) {
    if (event.pointerType !== "mouse") return;
    const rect = this.canvas.getBoundingClientRect();
    const now = performance.now() / 1000;
    const point = {
      x: (event.clientX - rect.left) / rect.width * 2 - 1,
      y: 1 - (event.clientY - rect.top) / rect.height * 2,
      time: now
    };
    const previous = this._lastPointer;
    this._lastPointer = point;
    if (!previous || now - previous.time > 0.2 || now <= previous.time) return;
    const dx = (point.x - previous.x) * (rect.width / rect.height) / (now - previous.time);
    const dy = (point.y - previous.y) / (now - previous.time);
    const speed = Math.hypot(dx, dy);
    if (speed < 0.12) return;
    const splash = Math.max(0, Math.min(1, Number(this._options.splash) || 0));
    const magnitude = Math.min(0.1, Math.max(0.015, 0.03 * speed * (0.25 + splash * 0.75)));
    this._brush.push({
      x: point.x,
      y: point.y,
      dx: dx / speed * magnitude,
      dy: dy / speed * magnitude,
      time: (performance.now() - this._timeStart) / 1000
    });
    if (this._brush.length > 6) this._brush.shift();
  }

  _brushUniforms(time) {
    const values = new Float32Array(24);
    const linger = 0.9 - 0.7 * Math.max(0, Math.min(1, Number(this._options.splash) || 0));
    this._brush.forEach((sample, index) => {
      const age = time - sample.time;
      if (age < 0 || age > 1.3) return;
      const fade = (1 - Math.exp(-age / 0.05)) * Math.exp(-age / linger);
      const offset = index * 4;
      values[offset] = sample.x;
      values[offset + 1] = sample.y;
      values[offset + 2] = sample.dx * fade;
      values[offset + 3] = sample.dy * fade;
    });
    return values;
  }

  _lampUniforms(time) {
    const values = new Float32Array(12);
    this._lights.forEach((light, index) => {
      const age = time - light.time;
      if (age < 0 || age > 2.4) return;
      const intensity = Math.min(1.1, (1 - Math.exp(-age / 0.05)) * Math.exp(-age / 0.55));
      values.set([light.x, light.y, light.z, intensity], index * 4);
    });
    return values;
  }

  _scan(time) {
    if (!this._options.scan) return [0, 0];
    const phase = time % 8 / 8;
    if (phase > 0.7) return [0, 0];
    const depth = Number(this._options.amplitude) || 0;
    return [
      0.55 * depth + 0.06 - (phase / 0.7) * (1.1 * depth + 0.12),
      Math.pow(Math.sin(Math.PI * phase / 0.7), 0.6)
    ];
  }

  _selectTrackers() {
    const amount = this._options.density === "dense" ? 16 : 5;
    const columns = Math.ceil(Math.sqrt(amount));
    const rows = Math.ceil(amount / columns);
    const selected = new Set();
    this._trackerIndices = [];
    for (let i = 0; i < amount && this._count; i++) {
      const targetX = ((i % columns) + 0.5) / columns * 2 - 1;
      const targetY = 1 - (Math.floor(i / columns) + 0.5) / rows * 2;
      let best = -Infinity;
      let bestIndex = -1;
      for (let index = 0; index < this._count; index++) {
        if (selected.has(index)) continue;
        const p = index * 3;
        const c = index * 4;
        const dx = this.positions[p] - targetX;
        const dy = this.positions[p + 1] - targetY;
        const range = (Math.max(this.colors[c], this.colors[c + 1], this.colors[c + 2]) - Math.min(this.colors[c], this.colors[c + 1], this.colors[c + 2])) / 255;
        const score = -(dx * dx + dy * dy) + range * 0.08 + this.colors[c + 3] / 255 * 0.02;
        if (score > best) { best = score; bestIndex = index; }
      }
      if (bestIndex >= 0) { selected.add(bestIndex); this._trackerIndices.push(bestIndex); }
    }
  }

  _projectPoint(index, time, fitX, fitY, aspect) {
    const i = index * 3;
    let px = this.positions[i];
    let py = this.positions[i + 1];
    let pz = this.positions[i + 2];
    const fraction = (value) => ((value % 1) + 1) % 1;
    const r1 = fraction(Math.sin(px * 12.9898 + py * 78.233) * 43758.5453);
    const r2 = fraction(Math.sin(py * 39.3468 + px * 11.135) * 24634.6345);
    const r3 = fraction(Math.sin(px * 93.9898 + py * 67.345) * 24634.6345);
    const r4 = fraction(Math.sin(py * 73.156 + px * 52.235) * 45624.123);
    const r5 = fraction(Math.sin(px * 47.131 + py * 19.117) * 31243.123);
    const line = this._options.line;
    const nx = -Math.sin(line.angle) * line.side;
    const ny = Math.cos(line.angle) * line.side;
    const along = (px - line.x) * -ny + (py - line.y) * nx;
    const ragged = 0.11 * Math.sin(along * 3.1 + time * 0.13) + 0.06 * Math.sin(along * 7.7 - time * 0.09 + 1.7) + (r5 - 0.5) * 0.34;
    const distance = (px - line.x) * nx + (py - line.y) * ny + ragged;
    const edge = Math.max(0, Math.min(1, distance / 1.15));
    const away = edge * edge * (3 - 2 * edge) * (this._options.drift > 0.0027 ? 1 : 0);
    if (away > 0) {
      const phaseValue = (time - 0.26 * 0.26) / (3.5 + 5.5 * r1) + r2;
      const phase = phaseValue - Math.floor(phaseValue);
      const hold = 0.82 + (0.06 - 0.82) * away;
      const gone = Math.max(0, (phase - hold) / (1 - hold));
      const travel = gone * Math.sqrt(gone);
      const reach = this._options.drift * 1.5 * 1.8 * away * (0.55 + 0.9 * r3);
      px += nx * reach * travel + Math.sin(along * 3 + time) * reach * travel * 0.04;
      py += ny * reach * travel + Math.cos(along * 2.4 - time) * reach * travel * 0.04;
      pz += (r4 - 0.5) * travel * reach * 0.6;
    }
    pz *= Number(this._options.amplitude) || 0;
    const cx = Math.cos(this._rotation[0]);
    const sx = Math.sin(this._rotation[0]);
    const cy = Math.cos(this._rotation[1]);
    const sy = Math.sin(this._rotation[1]);
    const rx = cy * px + sy * pz;
    const rz = -sy * px + cy * pz;
    const ry = cx * py - sx * rz;
    const perspective = 1 - rz * 0.14;
    let x = rx * fitX * this._zoom / perspective;
    let y = ry * fitY * this._zoom / perspective;
    const linger = 0.9 - 0.7 * Math.max(0, Math.min(1, Number(this._options.splash) || 0));
    let pushX = 0;
    let pushY = 0;
    for (const sample of this._brush) {
      const age = time - sample.time;
      if (age < 0 || age > 1.3) continue;
      const fade = (1 - Math.exp(-age / 0.05)) * Math.exp(-age / linger);
      const dx = (x - sample.x) * aspect;
      const dy = y - sample.y;
      const influence = Math.exp(-(dx * dx + dy * dy) * 22) * (0.45 + 1.1 * r1) * fade;
      const turn = (r2 - 0.5) * 1.3;
      pushX += (sample.dx - sample.dy * turn) * influence;
      pushY += (sample.dy + sample.dx * turn) * influence;
    }
    x += pushX / aspect;
    y += pushY;
    return {
      x: (x + 1) * this.clientWidth / 2,
      y: (1 - y) * this.clientHeight / 2,
      worldX: px,
      worldY: py,
      worldZ: pz
    };
  }

  _drawHud(time, fitX, fitY, aspect) {
    if (!this.hudContext) return;
    const ctx = this.hudContext;
    const ratio = Math.min(2, window.devicePixelRatio || 1);
    const width = this.clientWidth;
    const height = this.clientHeight;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, width, height);
    if (this._options.trails) this._drawTrails(time, fitX, fitY, aspect, ratio);
    else if (this.trailContext) {
      this.trailContext.clearRect(0, 0, this.trails.width, this.trails.height);
      this._trailPositions.clear();
    }
    if (!this._count || !this.positions) return;
    const points = this._trackerIndices.map((index, order) => ({
      index,
      order,
      point: this._projectPoint(index, time, fitX, fitY, aspect)
    }));
    const ink = this._options.paper === "light" ? "16,16,18" : "236,236,232";
    if (this._options.links) {
      const threshold = this._options.density === "dense" ? 0.46 : 1.05;
      ctx.strokeStyle = `rgba(${ink},.28)`;
      ctx.lineWidth = 1;
      for (let i = 0; i < points.length; i++) {
        const a = points[i];
        for (let j = i + 1; j < points.length; j++) {
          const b = points[j];
          const distance = Math.hypot(a.point.worldX - b.point.worldX, a.point.worldY - b.point.worldY, a.point.worldZ - b.point.worldZ);
          if (distance >= threshold) continue;
          ctx.beginPath();
          ctx.moveTo(a.point.x, a.point.y);
          ctx.lineTo(b.point.x, b.point.y);
          ctx.stroke();
        }
      }
    }
    if (this._options.track) {
      ctx.font = width < 540 ? "7px Consolas, monospace" : "9px Consolas, monospace";
      ctx.fillStyle = `rgba(${ink},.68)`;
      ctx.strokeStyle = `rgba(${ink},.72)`;
      for (const { point, order } of points) {
        const size = 5;
        const x = point.x;
        const y = point.y;
        ctx.beginPath();
        ctx.moveTo(x - size, y - size); ctx.lineTo(x - 1, y - size); ctx.moveTo(x - size, y - size); ctx.lineTo(x - size, y - 1);
        ctx.moveTo(x + size, y - size); ctx.lineTo(x + 1, y - size); ctx.moveTo(x + size, y - size); ctx.lineTo(x + size, y - 1);
        ctx.moveTo(x - size, y + size); ctx.lineTo(x - 1, y + size); ctx.moveTo(x - size, y + size); ctx.lineTo(x - size, y + 1);
        ctx.moveTo(x + size, y + size); ctx.lineTo(x + 1, y + size); ctx.moveTo(x + size, y + size); ctx.lineTo(x + size, y + 1);
        ctx.stroke();
        const label = width < 540
          ? String(order + 1).padStart(2, "0")
          : `${String(order + 1).padStart(2, "0")} ${point.worldX.toFixed(2)} ${point.worldY.toFixed(2)} ${point.worldZ.toFixed(2)}`;
        ctx.fillText(label, x + 9, order % 2 && width < 540 ? y + 12 : y - 8);
      }
    }
    if (this._options.marks) this._drawMarks(ctx, width, height, ink);
  }

  _drawTrails(time, fitX, fitY, aspect, ratio) {
    const ctx = this.trailContext;
    if (!ctx || !this._count) return;
    const width = this.trails.width;
    const height = this.trails.height;
    ctx.save();
    ctx.globalCompositeOperation = "destination-out";
    ctx.fillStyle = "rgba(0,0,0,.12)";
    ctx.fillRect(0, 0, width, height);
    ctx.restore();
    ctx.save();
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.strokeStyle = this._options.paper === "light" ? "rgba(16,16,18,.22)" : "rgba(236,236,232,.2)";
    ctx.lineWidth = 0.8;
    for (const index of this._trailIndices) {
      const point = this._projectPoint(index, time, fitX, fitY, aspect);
      const previous = this._trailPositions.get(index);
      if (previous && Math.hypot(point.x - previous.x, point.y - previous.y) > 0.08) {
        ctx.globalAlpha = Math.min(0.4, Math.hypot(point.x - previous.x, point.y - previous.y) * 0.05);
        ctx.beginPath();
        ctx.moveTo(previous.x, previous.y);
        ctx.lineTo(point.x, point.y);
        ctx.stroke();
      }
      this._trailPositions.set(index, { x: point.x, y: point.y });
    }
    ctx.restore();
  }

  _drawMarks(ctx, width, height, ink) {
    const inset = 12;
    const right = width - inset;
    const bottom = height - inset;
    ctx.strokeStyle = `rgba(${ink},.2)`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.rect(inset, inset, right - inset, bottom - inset);
    for (let i = 1; i < 20; i++) {
      const x = inset + (right - inset) * i / 20;
      const y = inset + (bottom - inset) * i / 20;
      const size = i % 5 === 0 ? 7 : 3;
      ctx.moveTo(x, inset); ctx.lineTo(x, inset + size);
      ctx.moveTo(x, bottom); ctx.lineTo(x, bottom - size);
      ctx.moveTo(inset, y); ctx.lineTo(inset + size, y);
      ctx.moveTo(right, y); ctx.lineTo(right - size, y);
    }
    ctx.stroke();
  }

  _hexToRgb(hex) {
    const value = /^#([0-9a-f]{6})$/i.exec(hex || "");
    if (!value) return [1, 0.91, 0.77];
    return [
      parseInt(value[1].slice(0, 2), 16) / 255,
      parseInt(value[1].slice(2, 4), 16) / 255,
      parseInt(value[1].slice(4, 6), 16) / 255
    ];
  }

  _loop() {
    if (this._viewReset) {
      const reset = this._viewReset;
      const progress = Math.min(1, (performance.now() - reset.start) / 520);
      const eased = progress * progress * (3 - 2 * progress);
      this._rotation[0] = reset.fromRotation[0] + (reset.toRotation[0] - reset.fromRotation[0]) * eased;
      this._rotation[1] = reset.fromRotation[1] + (reset.toRotation[1] - reset.fromRotation[1]) * eased;
      this._zoom = reset.fromZoom + (1 - reset.fromZoom) * eased;
      if (progress === 1) {
        this._rotation = [...DEFAULT_ROTATION];
        this._zoom = 1;
        this._viewReset = null;
      }
    }
    this._draw();
    this._frame = requestAnimationFrame(() => this._loop());
  }
}

if (!customElements.get("particle-cloud")) {
  customElements.define("particle-cloud", ParticleCloud);
}
