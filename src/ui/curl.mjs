const vertexSource = `
  attribute vec2 aVertex;
  varying vec2 vPoint;
  void main() {
    gl_Position = vec4(aVertex, 0.0, 1.0);
    vPoint = vec2(aVertex.x * .5 + .5, .5 - aVertex.y * .5);
  }
`;

// Inverse projection of a cylinder with a flat tangent beyond its half turn.
// The outer surface wins when both sides of the fold project onto one pixel.
const fragmentSource = `
  precision highp float;
  varying vec2 vPoint;
  uniform vec2 uStage;
  uniform vec4 uPage;
  uniform vec2 uNormal;
  uniform float uAxis;
  uniform float uRadius;
  uniform float uProgress;
  uniform float uHasBack;
  uniform float uBound;
  uniform float uSpine;
  uniform float uSpineSide;
  uniform sampler2D uFront;
  uniform sampler2D uBack;
  uniform vec2 uFrontRegion;
  uniform vec2 uBackRegion;
  const float PI = 3.14159265;

  bool inside(vec2 p) {
    return all(greaterThanEqual(p, vec2(0.0))) && all(lessThanEqual(p, uPage.zw));
  }

  vec2 region(vec2 uv, vec2 crop) {
    return vec2(crop.x + uv.x * crop.y, uv.y);
  }

  void main() {
    vec2 location = vPoint * uStage - uPage.xy;
    float d = dot(location, uNormal) - uAxis;
    float normalized = d / uRadius;
    vec4 color = vec4(0.0);
    float amount = smoothstep(0.0, .12, uProgress) * (1.0 - smoothstep(.88, 1.0, uProgress));
    if (d > 0.0 && inside(location)) {
      float shadow = exp(-abs(d - uRadius * .65) / (uRadius * .8));
      color = vec4(vec3(0.03), shadow * amount * .43);
    }

    if (uBound < .5 && !inside(location)) {
      gl_FragColor = color;
      return;
    }
    if (normalized > 1.0) {
      gl_FragColor = color;
      return;
    }

    float angle = normalized > 0.0 ? asin(normalized) : 0.0;
    float backDistance = PI * uRadius - (d <= 0.0 ? d : uRadius * angle);
    vec2 backPoint = location + uNormal * (backDistance - d);
    float frontDistance = d <= 0.0 ? d : uRadius * angle;
    vec2 frontPoint = location + uNormal * (frontDistance - d);

    if (inside(backPoint)) {
      vec2 uv = backPoint / uPage.zw;
      vec3 band = vec3(.87);
      vec3 back = uHasBack > .5
        ? texture2D(uBack, region(vec2(1.0 - uv.x, uv.y), uBackRegion)).rgb
        : vec3(mix(.92, dot(texture2D(uFront, region(uv, uFrontRegion)).rgb, vec3(.2126, .7152, .0722)), .09));
      back *= 1.0 - .22 * pow(max(0.0, normalized), 3.0);
      back = mix(back, band, .15 * smoothstep(.2, .88, normalized));
      gl_FragColor = vec4(back, 1.0);
    } else if (inside(frontPoint)) {
      vec3 front = texture2D(uFront, region(frontPoint / uPage.zw, uFrontRegion)).rgb;
      front *= 1.0 - .46 * pow(max(0.0, normalized), 2.0);
      float seam = uSpineSide > 0.0 ? frontPoint.x : uPage.z - frontPoint.x;
      front *= 1.0 - (uSpine * .22 * exp(-seam / 10.0));
      gl_FragColor = vec4(front, 1.0);
    } else {
      gl_FragColor = color;
    }
  }
`;

function shader(gl, type, source) {
  const result = gl.createShader(type);
  gl.shaderSource(result, source);
  gl.compileShader(result);
  if (!gl.getShaderParameter(result, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(result));
  return result;
}

function foldGeometry(paper, side, progress, tilt) {
  const slope = tilt * (1 - progress) ** .8;
  const length = Math.hypot(1, slope);
  const nx = side / length;
  const ny = slope / length;
  const far = Math.max(0, nx * paper.w) + Math.max(0, ny * paper.h);
  const near = Math.min(0, nx * paper.w) + Math.min(0, ny * paper.h);
  const radius = Math.max(.7, paper.w * (.003 + .095 * Math.sin(progress * Math.PI)));
  const axis = far + (near - far - radius * .85) * progress;
  return { nx, ny, axis, radius };
}

export function createCurl(canvas) {
  const gl = canvas.getContext('webgl', {
    alpha: true, antialias: false, premultipliedAlpha: false, preserveDrawingBuffer: true
  });
  if (!gl) return null;
  const program = gl.createProgram();
  gl.attachShader(program, shader(gl, gl.VERTEX_SHADER, vertexSource));
  gl.attachShader(program, shader(gl, gl.FRAGMENT_SHADER, fragmentSource));
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
  gl.useProgram(program);
  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  const position = gl.getAttribLocation(program, 'aVertex');
  gl.enableVertexAttribArray(position);
  gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
  const uniforms = {};
  for (const name of ['Stage', 'Page', 'Normal', 'Axis', 'Radius', 'Progress', 'HasBack', 'Bound',
    'Spine', 'SpineSide', 'Front', 'Back', 'FrontRegion', 'BackRegion']) {
    uniforms[name] = gl.getUniformLocation(program, 'u' + name);
  }

  const textures = [gl.createTexture(), gl.createTexture()];
  const loaded = [null, null];
  const maxSize = Math.min(2048, gl.getParameter(gl.MAX_TEXTURE_SIZE));
  const resizeBuffer = document.createElement('canvas');
  function upload(image, unit) {
    if (loaded[unit] === image.src) return;
    const ratio = Math.min(1, maxSize / Math.max(image.naturalWidth, image.naturalHeight));
    let source = image;
    if (ratio < 1) {
      resizeBuffer.width = Math.max(1, Math.round(image.naturalWidth * ratio));
      resizeBuffer.height = Math.max(1, Math.round(image.naturalHeight * ratio));
      resizeBuffer.getContext('2d').drawImage(image, 0, 0, resizeBuffer.width, resizeBuffer.height);
      source = resizeBuffer;
    }
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, textures[unit]);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    loaded[unit] = image.src;
  }

  function begin({ width, height, paper, back, side, bound }) {
    if (gl.isContextLost()) return null;
    const scale = Math.min(window.devicePixelRatio, 1.65, 2150 / width, 1500 / height);
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    gl.viewport(0, 0, canvas.width, canvas.height);
    upload(paper.image, 0);
    upload(back?.image || paper.image, 1);
    if (gl.getError() !== gl.NO_ERROR) {
      loaded.fill(null);
      return null;
    }
    gl.uniform1i(uniforms.Front, 0);
    gl.uniform1i(uniforms.Back, 1);
    gl.uniform2f(uniforms.Stage, width, height);
    gl.uniform1f(uniforms.HasBack, back?.image ? 1 : 0);
    gl.uniform1f(uniforms.Bound, bound ? 1 : 0);
    gl.uniform1f(uniforms.SpineSide, side);
    for (const [name, half] of [['FrontRegion', paper.half], ['BackRegion', back?.half]]) {
      gl.uniform2f(uniforms[name], (half ?? 0) / 2, half === undefined ? 1 : .5);
    }
    canvas.hidden = false;

    return function draw(progress, tilt, geometry = paper) {
      const { nx, ny, axis, radius } = foldGeometry(geometry, side, progress, tilt);
      gl.uniform4f(uniforms.Page, geometry.x, geometry.y, geometry.w, geometry.h);
      gl.uniform1f(uniforms.Spine, geometry.spine ?? (paper.side !== 'single' && paper.half === undefined ? 1 : 0));
      gl.uniform2f(uniforms.Normal, nx, ny);
      gl.uniform1f(uniforms.Radius, radius);
      gl.uniform1f(uniforms.Axis, axis);
      gl.uniform1f(uniforms.Progress, progress);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    };
  }

  return { begin };
}

// Clip the page along a diagonal, then reflect the lifted part across it.
// This uses Canvas 2D so a disabled WebGL context still shows a paper fold.
export function createPaperFold(canvas) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  return {
    begin({ width, height, paper, back, side, bound }) {
      const scale = Math.min(window.devicePixelRatio, 1.35, 1800 / width, 1250 / height);
      canvas.width = Math.max(1, Math.round(width * scale));
      canvas.height = Math.max(1, Math.round(height * scale));
      let w, h, corners;
      canvas.hidden = false;

      function paint({ image, half }) {
        const sourceWidth = half === undefined ? image.naturalWidth : image.naturalWidth / 2;
        ctx.drawImage(image, (half ?? 0) * sourceWidth, 0, sourceWidth, image.naturalHeight, 0, 0, w, h);
      }

      function clip(nx, ny, axis, sign) {
        const polygon = [];
        for (let index = 0; index < corners.length; index++) {
          const a = corners[index];
          const b = corners[(index + 1) % corners.length];
          const da = (a[0] * nx + a[1] * ny - axis) * sign;
          const db = (b[0] * nx + b[1] * ny - axis) * sign;
          if (da >= 0) polygon.push(a);
          if ((da < 0) !== (db < 0)) {
            const fraction = da / (da - db);
            polygon.push([a[0] + (b[0] - a[0]) * fraction, a[1] + (b[1] - a[1]) * fraction]);
          }
        }
        ctx.beginPath();
        polygon.forEach(([x, y], index) => index ? ctx.lineTo(x, y) : ctx.moveTo(x, y));
        ctx.closePath();
        ctx.clip();
      }

      function foldShade(nx, ny, axis, radius, stops) {
        const gradient = ctx.createLinearGradient(nx * axis, ny * axis, nx * (axis + radius), ny * (axis + radius));
        stops.forEach(([offset, color]) => gradient.addColorStop(offset, color));
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, w, h);
      }

      return (progress, tilt, geometry = paper) => {
        ({ w, h } = geometry);
        corners = [[0, 0], [w, 0], [w, h], [0, h]];
        const { nx, ny, axis, radius } = foldGeometry(geometry, side, progress, tilt);
        const crease = axis + radius * (.3 - .8 * progress);
        ctx.setTransform(scale, 0, 0, scale, 0, 0);
        ctx.clearRect(0, 0, width, height);
        ctx.save();
        ctx.translate(geometry.x, geometry.y);
        if (!bound) {
          ctx.beginPath();
          ctx.rect(0, 0, w, h);
          ctx.clip();
        }
        ctx.save();
        clip(nx, ny, crease, 1);
        foldShade(nx, ny, crease, radius * 2.6, [[0, '#0007'], [.35, '#0003'], [1, '#0000']]);
        ctx.restore();

        ctx.save();
        clip(nx, ny, crease, -1);
        paint(paper);
        foldShade(nx, ny, crease, -radius, [[0, '#0007'], [1, '#0000']]);
        ctx.restore();

        ctx.save();
        ctx.transform(1 - 2 * nx * nx, -2 * nx * ny, -2 * nx * ny, 1 - 2 * ny * ny,
          2 * nx * crease, 2 * ny * crease);
        clip(nx, ny, crease, 1);
        ctx.fillStyle = '#e6e6e6';
        ctx.fillRect(0, 0, w, h);
        ctx.save();
        ctx.translate(w, 0);
        ctx.scale(-1, 1);
        ctx.globalAlpha = back?.image ? 1 : .15;
        paint(back?.image ? back : paper);
        ctx.restore();
        foldShade(nx, ny, crease, radius * 2.2, [[0, '#0008'], [.25, '#fff6'], [1, '#fff0']]);
        ctx.restore();
        ctx.restore();
      };
    }
  };
}
