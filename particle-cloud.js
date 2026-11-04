const vertexSource = [
  "attribute vec3 a_position;",
  "attribute vec4 a_color;",
  "uniform vec2 u_fit;",
  "uniform vec2 u_rotation;",
  "uniform float u_zoom;",
  "uniform float u_amplitude;",
  "uniform float u_drift;",
  "uniform float u_time;",
  "uniform float u_point_size;",
  "uniform vec3 u_tint;",
  "varying vec4 v_color;",
  "void main() {",
  "  float cx = cos(u_rotation.x), sx = sin(u_rotation.x);",
  "  float cy = cos(u_rotation.y), sy = sin(u_rotation.y);",
  "  float px = a_position.x;",
  "  float py = a_position.y;",
  "  float pz = a_position.z * u_amplitude;",
  "  float rx = cy * px + sy * pz + sin(u_time + py * 8.0) * u_drift * 0.009;",
  "  float rz = -sy * px + cy * pz;",
  "  float ry = cx * py - sx * rz + cos(u_time + px * 7.0) * u_drift * 0.009;",
  "  float perspective = 1.0 - rz * 0.14;",
  "  gl_Position = vec4(rx * u_fit.x * u_zoom / perspective, ry * u_fit.y * u_zoom / perspective, rz * 0.08, 1.0);",
  "  gl_PointSize = u_point_size;",
  "  v_color = vec4(a_color.rgb * u_tint, a_color.a);",
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
    return ["image", "depth", "amplitude", "drift", "point-size", "tint"];
  }

  constructor() {
    super();
    this._options = { amplitude: 0.72, drift: 0.35, pointSize: 1.6, tint: "#ffe9c4" };
    this._rotation = [0.14, -0.16];
    this._zoom = 1;
    this._timeStart = performance.now();
    this._frame = 0;
    this._version = 0;
    this._count = 0;
    this._drag = null;
    this.attachShadow({ mode: "open" });
  }

  connectedCallback() {
    this.shadowRoot.innerHTML = [
      "<style>",
      ":host{display:block;position:relative;width:100%;height:100%;outline:none}",
      "canvas{display:block;width:100%;height:100%;touch-action:none}",
      ".fallback{position:absolute;inset:0;width:100%;height:100%;object-fit:contain;background:#050505}",
      "</style>",
      "<canvas part='canvas' role='img' aria-label='Moving particle image' tabindex='0'></canvas>",
      "<img class='fallback' alt='' hidden>"
    ].join("");
    this.canvas = this.shadowRoot.querySelector("canvas");
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
    if (name === "point-size") this._options.pointSize = Number(newValue) || 1;
    if (name === "tint") this._options.tint = newValue || "#ffe9c4";
  }

  get pointCount() {
    return this._count;
  }

  setData(data) {
    if (!data || !data.image || !data.depth) {
      this._imageSource = "";
      this._depthSource = "";
      this._count = 0;
      this._draw();
      return Promise.resolve();
    }
    this._imageSource = data.image;
    this._depthSource = data.depth;
    return this._loadData();
  }

  setOptions(options) {
    Object.assign(this._options, options || {});
  }

  resetView() {
    this._rotation = [0.14, -0.16];
    this._zoom = 1;
  }

  _readAttributes() {
    this._imageSource = this.getAttribute("image") || "";
    this._depthSource = this.getAttribute("depth") || "";
    this._options.amplitude = Number(this.getAttribute("amplitude") || 0.72);
    this._options.drift = Number(this.getAttribute("drift") || 0.35);
    this._options.pointSize = Number(this.getAttribute("point-size") || 1.6);
    this._options.tint = this.getAttribute("tint") || "#ffe9c4";
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
    this.colorBuffer = gl.createBuffer();
    this.locations = {
      position: gl.getAttribLocation(program, "a_position"),
      color: gl.getAttribLocation(program, "a_color"),
      fit: gl.getUniformLocation(program, "u_fit"),
      rotation: gl.getUniformLocation(program, "u_rotation"),
      zoom: gl.getUniformLocation(program, "u_zoom"),
      amplitude: gl.getUniformLocation(program, "u_amplitude"),
      drift: gl.getUniformLocation(program, "u_drift"),
      time: gl.getUniformLocation(program, "u_time"),
      pointSize: gl.getUniformLocation(program, "u_point_size"),
      tint: gl.getUniformLocation(program, "u_tint")
    };
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  }

  _bindControls() {
    this.canvas.addEventListener("pointerdown", (event) => {
      this._drag = { x: event.clientX, y: event.clientY };
      this.canvas.setPointerCapture(event.pointerId);
    });
    this.canvas.addEventListener("pointermove", (event) => {
      if (!this._drag) return;
      const dx = event.clientX - this._drag.x;
      const dy = event.clientY - this._drag.y;
      this._rotation[1] += dx * 0.008;
      this._rotation[0] += dy * 0.008;
      this._drag = { x: event.clientX, y: event.clientY };
    });
    const stopDrag = () => { this._drag = null; };
    this.canvas.addEventListener("pointerup", stopDrag);
    this.canvas.addEventListener("pointercancel", stopDrag);
    this.canvas.addEventListener("wheel", (event) => {
      event.preventDefault();
      this._zoom = Math.min(1.9, Math.max(0.58, this._zoom - event.deltaY * 0.001));
    }, { passive: false });
    this.canvas.addEventListener("keydown", (event) => {
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
      const step = Math.max(1, Math.ceil(Math.sqrt(width * height / 70000)));
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
      this._uploadedVersion = -1;
      this._draw();
      this.dispatchEvent(new CustomEvent("points-ready", { bubbles: true, detail: { count } }));
    } catch (error) {
      this.dispatchEvent(new CustomEvent("render-error", { bubbles: true, detail: error.message || String(error) }));
    }
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
  }

  _draw() {
    if (!this.gl || !this.program) return;
    const gl = this.gl;
    this._resize();
    gl.clearColor(0.015, 0.015, 0.015, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    if (!this._count || !this.positions || !this.colors) return;
    gl.useProgram(this.program);
    if (this._uploadedVersion !== this._version) {
      gl.bindBuffer(gl.ARRAY_BUFFER, this.positionBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, this.positions, gl.STATIC_DRAW);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.colorBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, this.colors, gl.STATIC_DRAW);
      this._uploadedVersion = this._version;
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, this.positionBuffer);
    gl.enableVertexAttribArray(this.locations.position);
    gl.vertexAttribPointer(this.locations.position, 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.colorBuffer);
    gl.enableVertexAttribArray(this.locations.color);
    gl.vertexAttribPointer(this.locations.color, 4, gl.UNSIGNED_BYTE, true, 0, 0);

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
    gl.uniform1f(this.locations.drift, Number(this._options.drift) || 0);
    gl.uniform1f(this.locations.time, (performance.now() - this._timeStart) / 1000);
    gl.uniform1f(this.locations.pointSize, Math.max(1, Number(this._options.pointSize) * ratio));
    gl.uniform3f(this.locations.tint, tint[0], tint[1], tint[2]);
    gl.drawArrays(gl.POINTS, 0, this._count);
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
    this._draw();
    this._frame = requestAnimationFrame(() => this._loop());
  }
}

if (!customElements.get("particle-cloud")) {
  customElements.define("particle-cloud", ParticleCloud);
}
