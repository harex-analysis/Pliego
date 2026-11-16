import { pageRaster, pageScale } from './page-art.mjs';

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
  uniform vec2 uOverhang;
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

    vec2 outside = max(-location, location - uPage.zw);
    float visible = uBound > .5 ? 1.0 :
      (outside.x > 0.0 ? uOverhang.x : 1.0) * (outside.y > 0.0 ? uOverhang.y : 1.0);
    if (visible <= 0.0) {
      gl_FragColor = vec4(0.0);
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
      gl_FragColor = vec4(back, visible);
    } else if (inside(frontPoint)) {
      vec3 front = texture2D(uFront, region(frontPoint / uPage.zw, uFrontRegion)).rgb;
      front *= 1.0 - .46 * pow(max(0.0, normalized), 2.0);
      float seam = uSpineSide > 0.0 ? frontPoint.x : uPage.z - frontPoint.x;
      front *= 1.0 - (uSpine * .22 * exp(-seam / 10.0));
      gl_FragColor = vec4(front, visible);
    } else {
      gl_FragColor = color;
    }
  }
`;

const waveSpan = .44;
const rollBend = .42;
const rootLength = .25;
const looseTip = .28;
const cornerContactStart = .61;

const meshVertexSource = `
  attribute vec2 aVertex;
  uniform vec2 uStage;
  uniform vec4 uPage;
  uniform vec2 uNormal;
  uniform float uAxis;
  uniform float uRadius;
  uniform float uTaper;
  uniform float uGripY;
  uniform float uFlex;
  uniform float uShadowPass;
  uniform float uAdaptive;
  uniform float uSpineSide;
  uniform vec3 uWave;
  uniform float uWaveLean;
  uniform float uCenterTurn;
  uniform float uCenterRoot;
  uniform vec4 uCenterFlex;
  uniform vec2 uCenterCorners;
  varying vec2 vUV;
  varying vec2 vSlope;
  varying vec2 vPoint;
  varying float vHeight;
  varying float vWaveSlope;
  const float PI = 3.14159265;

  float travel(float distance, float radius) {
    float angle = clamp(distance / radius, 0.0, PI);
    return max(0.0, distance) + max(0.0, distance - PI * radius) - radius * sin(angle);
  }

  vec2 paperArc(float span, float start, float end) {
    if (abs(end - start) < .0001) return span * vec2(cos(start), sin(start));
    return span / (end - start) * vec2(sin(end) - sin(start), cos(start) - cos(end));
  }

  vec3 turnSection(float reach, float width, float turn, float tip, float contact) {
    // Keep part of the sheet against the binding until the rolling bend reaches it.
    float root = uCenterRoot * width * (1.0 - smoothstep(.08, 1.24, turn));
    if (reach <= root) return vec3(reach, 0.0, 0.0);
    reach -= root;
    width -= root;
    float bend = ${rollBend} * width * max(0.0, sin(turn));
    if (reach < bend) {
      float angle = turn * reach / bend;
      return vec3(vec2(root, 0.0) + paperArc(reach, 0.0, angle), angle);
    }
    vec2 base = vec2(root, 0.0) + paperArc(bend, 0.0, turn);
    float available = width - bend;
    float outside = max(0.0, reach - bend);
    if (contact <= 0.0 || turn <= 2.20) {
      float angle = turn + tip * outside / available;
      return vec3(base + paperArc(outside, turn, angle), angle);
    }
    float influence = contact * smoothstep(2.20, 2.72, turn);
    float middle = mix(turn + .48 * tip, PI + min(.95, 2.35 * (PI - turn)), influence);
    float end = mix(turn + tip, PI, influence);
    float firstDrop = paperArc(.48, turn, middle).y;
    float floorGap = base.y + available * (firstDrop + paperArc(.52, middle, PI).y);
    float flatten = smoothstep(0.0, .16, contact) * (1.0 - smoothstep(0.0, width * .07, floorGap));
    end = mix(end, PI, flatten);
    float drop = firstDrop + paperArc(.52, middle, end).y;
    float moving = available;
    if (drop < -.000001 && base.y + available * drop < 0.0) {
      moving = min(available, base.y / -drop);
    }
    float first = min(outside, .48 * moving);
    float second = min(max(0.0, outside - first), .52 * moving);
    float a = mix(turn, middle, first / max(.0001, .48 * moving));
    float b = mix(middle, end, second / max(.0001, .52 * moving));
    vec2 position = base + paperArc(first, turn, a) + paperArc(second, middle, b);
    position.x -= max(0.0, outside - moving);
    return vec3(position, second > 0.0 ? b : a);
  }

  float rowProfile(float row) {
    return mix(row, smoothstep(0.0, 1.0, row), .56);
  }

  void main() {
    vUV = aVertex;
    vec2 point = aVertex * uPage.zw;
    float ripple = 0.0;
    vWaveSlope = 0.0;
    if (uWave.x > 0.0) {
      float span = uWave.z * uPage.z;
      float reach = uSpineSide > 0.0 ? point.x : uPage.z - point.x;
      float row = aVertex.y - uGripY;
      float height = uCenterTurn < 0.0 ? uWave.x : uWave.x * (1.0 - .56 * smoothstep(.04, .77, abs(row)));
      float center = clamp(uWave.y + row * uWaveLean, uWave.z * .5, 1.0 - uWave.z * .5) * uPage.z;
      float t = clamp((reach - center) / span + .5, 0.0, 1.0);
      float peakSlope = PI * height / span;
      // Integrating the horizontal projection keeps the raised paper from stretching sideways.
      float loss = .25 * peakSlope * peakSlope * span * (t - sin(4.0 * PI * t) / (4.0 * PI));
      point.x -= uSpineSide * loss;
      float rise = sin(PI * t);
      ripple = height * rise * rise;
      vWaveSlope = uSpineSide * peakSlope * sin(2.0 * PI * t);
    }
    float awayFromGrip = smoothstep(0.0, .72, abs(aVertex.y - uGripY));
    float distance = dot(point, uNormal) - uAxis - uFlex * awayFromGrip;
    float radius = uRadius * (1.0 + .44 * uTaper * (2.0 * aVertex.y - 1.0));
    float angle = clamp(distance / radius, 0.0, PI);
    vec2 normal = uNormal;
    if (uCenterTurn >= 0.0) {
      float spine = uSpineSide > 0.0 ? 0.0 : uPage.z;
      float reach = abs(point.x - spine);
      float row = rowProfile(aVertex.y) - rowProfile(uGripY);
      float lead = uCenterFlex.w * smoothstep(0.0, .72, abs(aVertex.y - uGripY));
      float rowTurn = clamp(uCenterTurn + uCenterFlex.y * row + lead, 0.0, PI);
      vec2 corners = smoothstep(vec2(${cornerContactStart}), vec2(1.0), vec2(1.0 - aVertex.y, aVertex.y));
      float contact = uCenterFlex.z * (1.0 - dot(uCenterCorners, corners));
      vec3 rolled = turnSection(reach, uPage.z, rowTurn, uCenterFlex.x, contact);
      angle = rolled.z;
      vHeight = max(0.0, rolled.y);
      normal = vec2(uSpineSide, 0.0);
      vPoint = vec2(spine + uSpineSide * rolled.x, point.y);
    } else {
      vHeight = radius * (1.0 - cos(angle));
      vPoint = point - normal * travel(distance, radius);
    }
    vSlope = vec2(cos(angle), max(0.0, sin(angle)));
    if (uWave.x > 0.0) {
      vPoint -= normal * (ripple * sin(angle));
      vHeight = max(0.0, vHeight + ripple * cos(angle));
      // A shallow perspective shift makes the ridge visible in horizontal panel borders.
      vPoint.y += (aVertex.y - .28) * ripple * .36;
      vWaveSlope *= cos(angle);
    }
    if (uCenterTurn >= 0.0) {
      vPoint.y += (aVertex.y - .42) * min(18.0, vHeight * .12);
    }
    if (uWave.x > 0.0 || uCenterTurn >= 0.0) {
      vPoint.y = clamp(vPoint.y, min(0.0, 1.0 - uPage.y), max(uPage.w, uStage.y - uPage.y - 1.0));
    }
    if (uShadowPass > .5) {
      vPoint += vec2(.13, .38) * vHeight;
    } else if (uAdaptive < .5) {
      vPoint.y -= .19 * vHeight;
    }
    vec2 screen = (vPoint + uPage.xy) / uStage;
    gl_Position = vec4(2.0 * screen.x - 1.0, 1.0 - 2.0 * screen.y,
      -min(.95, vHeight / uStage.y), 1.0);
  }
`;

const meshFragmentSource = `
  precision highp float;
  uniform vec4 uPage;
  uniform float uRadius;
  uniform float uProgress;
  uniform float uHasBack;
  uniform float uBound;
  uniform float uSpine;
  uniform float uSpineSide;
  uniform float uShadowPass;
  uniform float uAdaptive;
  uniform float uCenterTurn;
  uniform vec2 uOverhang;
  uniform sampler2D uFront;
  uniform sampler2D uBack;
  uniform vec2 uFrontRegion;
  uniform vec2 uBackRegion;
  varying vec2 vUV;
  varying vec2 vSlope;
  varying vec2 vPoint;
  varying float vHeight;
  varying float vWaveSlope;

  void main() {
    vec2 outside = max(-vPoint, vPoint - uPage.zw);
    float visible = uBound > .5 ? 1.0 :
      (outside.x > 0.0 ? uOverhang.x : 1.0) * (outside.y > 0.0 ? uOverhang.y : 1.0);
    if (visible <= 0.0) discard;
    if (uShadowPass > .5) {
      if (vHeight < .35) discard;
      if (uAdaptive > .5 && any(greaterThan(outside, vec2(0.0)))) discard;
      float fade = smoothstep(0.0, .10, uProgress) * (1.0 - smoothstep(.82, 1.0, uProgress));
      float shadowDepth = uCenterTurn >= 0.0 ? max(8.0, uPage.z * .05) : max(3.0, uRadius * 1.7);
      float shadow = smoothstep(.35, max(1.0, uRadius * .65), vHeight) * exp(-vHeight / shadowDepth);
      gl_FragColor = vec4(vec3(.025), shadow * fade * .62 * visible);
      return;
    }

    float rippleLight = clamp(1.0 - .60 * vWaveSlope - .18 * vWaveSlope * vWaveSlope, .66, 1.10);
    vec3 front = texture2D(uFront, vec2(uFrontRegion.x + vUV.x * uFrontRegion.y, vUV.y)).rgb;
    if (gl_FrontFacing) {
      float seam = (uSpineSide > 0.0 ? vUV.x : 1.0 - vUV.x) * uPage.z;
      float light = 1.0 - (uCenterTurn >= 0.0 ? .32 : (uAdaptive > .5 ? .46 : .38)) * vSlope.y * vSlope.y;
      gl_FragColor = vec4(front * light * rippleLight * (1.0 - uSpine * .22 * exp(-seam / 10.0)), visible);
    } else {
      float mirrored = uBackRegion.x + (1.0 - vUV.x) * uBackRegion.y;
      vec3 back = uHasBack > .5
        ? texture2D(uBack, vec2(mirrored, vUV.y)).rgb
        : vec3(mix(.93, dot(front, vec3(.2126, .7152, .0722)), .08));
      float light = .97 - .24 * vSlope.y + .15 * pow(vSlope.y, 5.0);
      if (uAdaptive > .5) {
        back *= 1.0 - .22 * pow(vSlope.y, 3.0);
        back = mix(back, vec3(.87), .15 * smoothstep(.2, .88, vSlope.y));
        light = 1.0;
      }
      gl_FragColor = vec4(back * light * rippleLight, visible);
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

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

function smoothStep(min, max, value) {
  const t = clamp((value - min) / (max - min), 0, 1);
  return t * t * (3 - 2 * t);
}

export function pullPaper(sheet, side, start, point, held, mesh = false) {
  const x = clamp((start.x - sheet.x) / sheet.w, 0, 1);
  const y = clamp((start.y - sheet.y) / sheet.h, 0, 1);
  const inward = (start.x - point.x) * side / sheet.w;
  const vertical = (point.y - start.y) / sheet.h;
  const lift = held ? .075 : .026;
  const progress = clamp(lift + inward / (mesh ? 1.12 : 1.06) + (mesh ? Math.abs(vertical) * .22 : 0), 0, .98);
  const tilt = (2 * y - 1) * .48;
  return mesh
    ? { progress, tilt: clamp(tilt + vertical * 1.25, -.72, .72),
      grip: { x, y, inward, vertical, lift, taper: (1 - 2 * y) * .8 } }
    : { progress, tilt, grip: {
      x, y, inward, vertical, held,
      point: { x: sheet.x + x * sheet.w + point.x - start.x, y: sheet.y + y * sheet.h + point.y - start.y }
    } };
}

export function settlePaper(time, initialSpeed = 0) {
  // Critically damped spring, normalized so the sheet reaches its rest pose on time.
  const speed = clamp(initialSpeed, 0, 7);
  const remaining = t => (1 + (9 - speed) * t) * Math.exp(-9 * t);
  return (1 - remaining(time)) / (1 - remaining(1));
}

function pullAxis(distance, radius) {
  if (distance <= 0) return 0;
  const arc = Math.PI * radius;
  if (distance >= arc) return (distance + arc) / 2;
  // Solve the arc-length displacement at the point being held.
  let low = 0;
  let high = arc;
  for (let i = 0; i < 15; i++) {
    const mid = (low + high) / 2;
    if (mid - radius * Math.sin(mid / radius) < distance) low = mid;
    else high = mid;
  }
  return (low + high) / 2;
}

function foldTravel(offset, radius) {
  if (offset <= 0) return 0;
  const arc = Math.PI * radius;
  return offset >= arc ? 2 * offset - arc : offset - radius * Math.sin(offset / radius);
}

function minimumFoldAxis(paper, height, nx, ny, radius, zoomed) {
  const edge = nx > 0 ? paper.w : 0;
  const hinge = nx * (paper.w - edge) + Math.max(0, ny * paper.h);
  // At higher zoom the viewport clips the paper without constraining its motion.
  if (zoomed || !ny) return hinge;
  const room = Math.max(0, ny > 0 ? paper.y - 1 : height - 1 - paper.y - paper.h);
  // The vertical extrema of the cylinder projection occur at the sheet corners.
  const first = nx * edge - pullAxis((ny > 0 ? room : room + paper.h) / Math.abs(ny), radius);
  const last = nx * edge + ny * paper.h - pullAxis((ny > 0 ? room + paper.h : room) / Math.abs(ny), radius);
  return Math.max(hinge, first, last);
}

function constrainFold(paper, pose, height, grip, flat, zoomed) {
  const side = Math.sign(pose.nx);
  const edge = side > 0 ? paper.w : 0;
  const key = flat ? 'crease' : 'axis';
  const radius = flat ? 0 : pose.radius;
  const axis = minimumFoldAxis(paper, height, pose.nx, pose.ny, radius, zoomed);
  if (pose[key] >= axis) return pose;
  const x = grip?.point ? grip.x * paper.w : edge;
  const y = (grip?.y ?? .5) * paper.h;
  const offset = pose.nx * x + pose.ny * y - pose[key];
  if (offset <= 0) return { ...pose, [key]: axis };

  const wanted = foldTravel(offset, radius);
  const dx = pose.nx * wanted;
  const dy = pose.ny * wanted;
  const desiredAngle = Math.atan2(pose.ny, Math.abs(pose.nx));
  let bestError = Infinity;
  let best = pose;
  let bestT = 0;

  function findClosest(t) {
    const angle = desiredAngle * t;
    const nx = side * Math.cos(angle);
    const ny = Math.sin(angle);
    const anchor = nx * x + ny * y;
    const limit = minimumFoldAxis(paper, height, nx, ny, radius, zoomed);
    const travel = Math.min(nx * dx + ny * dy, foldTravel(anchor - limit, radius));
    const error = (dx - nx * travel) ** 2 + (dy - ny * travel) ** 2 +
      ((1 - t) * desiredAngle * paper.w * .035) ** 2;
    if (error <= bestError) {
      bestError = error;
      bestT = t;
      best = { ...pose, nx, ny, [key]: Math.max(limit, anchor - pullAxis(travel, radius)) };
    }
    return error;
  }

  const samples = 12;
  for (let i = 0; i <= samples; i++) findClosest(i / samples);
  let low = Math.max(0, bestT - 1 / samples);
  let high = Math.min(1, bestT + 1 / samples);
  for (let i = 0; i < 8; i++) {
    const left = (2 * low + high) / 3;
    const right = (low + 2 * high) / 3;
    if (findClosest(left) <= findClosest(right)) high = right;
    else low = left;
  }
  return best;
}

function advanceCenterTurn(state, target, elapsed) {
  const direction = target === 0 ? -1 : 1;
  // Small, bounded steps keep inertia, gravity and damping independent of display refresh.
  for (let left = elapsed; left > 0;) {
    const step = Math.min(left, 1 / 160);
    const remaining = Math.max(0, direction * (target - state.angle));
    const stiffness = direction > 0 ? 254 - 102 * smoothStep(.58, 1.64, remaining) : 254;
    const gravity = direction > 0 ? 38 * smoothStep(1.45, 2.40, state.angle) * smoothStep(.02, .48, remaining) : 0;
    const damping = 28 + 8 * (1 - smoothStep(.07, .51, remaining));
    state.speed = Math.max(0, state.speed + (stiffness * remaining + gravity - damping * state.speed) * step);
    state.angle += direction * Math.min(remaining, state.speed * step);
    left -= step;
  }
  if (Math.abs(target - state.angle) < .009 && state.speed < .24) {
    state.angle = target;
    state.speed = 0;
  }
}

function trackFold(width, height, zoomed, flat = false) {
  const key = flat ? 'crease' : 'axis';
  const points = [0, .25, .5, .75, 1];
  let previous;
  let previousTime;
  let previousPoint;
  let momentum = 0;
  let verticalMotion = 0;
  let centerVelocity = 0;
  let centerRelease;
  let pickupAt;
  let holdAt;

  return (paper, side, progress, tilt, grip, time) => {
    const corner = cornerGripWeight(side, grip);
    let lifting = false;
    if (corner > 0 && !isCenterGrip(side, grip)) {
      pickupAt ??= time;
      if (grip.held) holdAt ??= time;
      const pickup = smoothStep(0, 72, time - pickupAt);
      const hold = grip.held ? smoothStep(0, 90, time - holdAt) : 0;
      // Let a corner lift into the grip before adding the extra curl of a long press.
      const initialLift = .016 * (1 - corner * (1 - pickup));
      const extraLift = grip.held ? .027 * (1 - corner * (1 - hold)) : 0;
      grip = { ...grip, cornerLift: initialLift + extraLift };
      lifting = grip.release === undefined && (pickup < 1 || (grip.held && hold < 1));
    }
    const pose = foldGeometry(paper, side, progress, tilt, grip);
    const target = pose.centerTurn === undefined ? constrainFold(paper, pose, height, grip, flat, zoomed) : pose;
    // Timed turns already ease into their target poses. Only a live grip needs motion limiting.
    if (!previous || !grip?.point) {
      previous = target;
      previousTime = time;
      previousPoint = grip?.point;
      return target;
    }
    const point = grip?.point;
    const dy = point && previousPoint ? point.y - previousPoint.y : 0;
    const drag = point && previousPoint ? Math.hypot(point.x - previousPoint.x, dy) : 0;
    const interval = time - previousTime;
    const elapsed = clamp(interval, 1, 28);
    momentum = Math.max(momentum * Math.exp(-elapsed / 24), clamp((drag - 6) * 4.5, 0, 150));
    const wantedWave = target.wave ?? 0;
    const oldWave = previous.wave ?? 0;
    const waveLimit = elapsed * .24 + .018 * momentum;
    const difference = wantedWave - oldWave;
    const wave = Math.abs(difference) <= waveLimit ? wantedWave : oldWave + Math.sign(difference) * waveLimit;
    previousPoint = point;
    previousTime = time;
    if (target.centerTurn !== undefined) {
      const before = previous.centerTurn ?? 0;
      const timeReleased = grip.release ?? 0;
      const touch = clamp(grip.vertical * 1.15 + (.5 - grip.y) * .78, -.42, .42);
      const follow = 1 - Math.exp(-elapsed / 25);
      const followRidge = (old, wanted) => old === undefined || Math.abs(old - wanted) < .001
        ? wanted : old + (wanted - old) * follow;
      const waveCenter = followRidge(previous.waveCenter, target.waveCenter);
      const waveLean = followRidge(previous.waveLean, target.waveLean);
      let centerTurn;
      let moving;
      if (grip.release !== undefined) {
        const end = grip.finish ? Math.PI : 0;
        if (!centerRelease) {
          const toward = grip.finish ? 1 : -1;
          centerRelease = { angle: before, speed: interval < 80 ? clamp(centerVelocity * toward * 850, 0, 10) : 0 };
          if (grip.finish) {
            const skew = previous.skew ?? 0;
            const lead = previous.lead ?? 0;
            const row = .44 * grip.y + .56 * smoothStep(0, 1, grip.y);
            const ahead = Math.max(
              Math.max(0, -skew * row) + Math.max(0, lead) * smoothStep(0, .72, grip.y),
              Math.max(0, skew * (1 - row)) + Math.max(0, lead) * smoothStep(0, .72, 1 - grip.y)
            );
            centerRelease.edge = { skew, lead, ahead, angle: before };
          }
        } else {
          advanceCenterTurn(centerRelease, end, Math.min(.048, interval / 1000));
        }
        centerTurn = centerRelease.angle;
        moving = centerTurn !== end;
      } else {
        const limit = elapsed * .0075 + momentum * .0015;
        const delta = target.centerTurn - before;
        centerTurn = Math.abs(delta) <= limit ? target.centerTurn : before + Math.sign(delta) * limit;
        centerVelocity += ((centerTurn - before) / elapsed - centerVelocity) * Math.min(1, elapsed / 34);
        moving = centerTurn !== target.centerTurn;
      }
      const heldContact = .44 * smoothStep(2.45, 3.04, centerTurn);
      const releaseContact = grip.finish ? smoothStep(0, .40, timeReleased) : 0;
      const contact = heldContact * (grip.weight ?? 1) * (1 - releaseContact) + releaseContact;
      const tip = -looseTip * Math.sin(centerTurn);
      const landing = contact * smoothStep(1.62, 2.66, centerTurn);
      const balance = clamp((.5 - grip.y) * 2.3 + touch * .56, -1, 1);
      const remaining = Math.PI - centerTurn;
      const bend = Math.sin(centerTurn);
      let skew = touch * bend * (1 - timeReleased) + balance * landing * Math.min(.94, remaining * 2.7);
      let lead = bend * (smoothStep(.54, 1.72, centerTurn) * .45 - .12) + landing * Math.min(.29, remaining);
      let upperDelay = 0;
      let lowerDelay = 0;
      if (centerRelease?.edge) {
        const edge = centerRelease.edge;
        // Let the rest of the sheet catch up with the leading corner as the paper straightens.
        const shape = Math.min(remaining / Math.max(.001, Math.PI - edge.angle),
          1 - smoothStep(0, Math.max(.001, 1.5 * edge.ahead), centerTurn - edge.angle));
        skew = edge.skew * shape;
        lead = edge.lead * shape;
        // Extend the bend into the free corners while the middle of the edge makes contact.
        const cornerDelay = .40 * smoothStep(0, .17, timeReleased) * smoothStep(2.32, 2.68, centerTurn) *
          smoothStep(.31, .78, contact) * (1 - smoothStep(2.93, Math.PI, centerTurn));
        upperDelay = cornerDelay * (1 + .12 * balance);
        lowerDelay = cornerDelay * (1 - .12 * balance);
      }
      const ridgeMoving = wave > 0 && (waveCenter !== target.waveCenter || waveLean !== target.waveLean);
      previous = { ...target, centerTurn, wave, waveCenter, waveLean, tip, skew, contact, lead, upperDelay, lowerDelay,
        moving: wave !== wantedWave || ridgeMoving || moving };
      return previous;
    }
    if (drag > .2) verticalMotion = smoothStep(.50, .91, Math.abs(dy) / drag);
    else verticalMotion *= Math.exp(-elapsed / 45);
    const outside = grip?.point ? outsideGrip(side, grip) : 0;
    const edgeFollow = grip?.point && grip.release === undefined ? sideGripWeight(side, grip) * verticalMotion : 0;
    const falling = grip?.release !== undefined ? outside * smoothStep(0, .24, grip.release) : 0;
    const speed = 1.4 + 2.6 * edgeFollow + (4.6 + 1.2 * corner) * falling;
    const maxMotion = elapsed * speed + momentum * (1 - .42 * outside);
    const oldLimit = minimumFoldAxis(paper, height, previous.nx, previous.ny, flat ? 0 : previous.radius, zoomed);
    if (previous[key] < oldLimit) previous = { ...previous, [key]: oldLimit };
    const wantedFlex = flat ? 0 : target.flex;
    const flexStep = .38 * elapsed;
    const deltaFlex = wantedFlex - previous.flex;
    const flex = Math.abs(deltaFlex) <= flexStep ? wantedFlex : previous.flex + Math.sign(deltaFlex) * flexStep;
    const left = zoomed ? clamp(-paper.x, 0, paper.w) : 0;
    const right = zoomed ? clamp(width - paper.x, 0, paper.w) : paper.w;
    const top = zoomed ? clamp(-paper.y, 0, paper.h) : 0;
    const bottom = zoomed ? clamp(height - paper.y, 0, paper.h) : paper.h;
    const flexByRow = !flat && (previous.flex || flex) ? points.map(v =>
      smoothStep(0, .72, Math.abs((top + (bottom - top) * v) / paper.h - (grip?.y ?? .5)))) : undefined;
    function movement(candidate) {
      let max = 0;
      for (const u of points) {
        const x = left + (right - left) * u;
        for (let row = 0; row < points.length; row++) {
          const y = top + (bottom - top) * points[row];
          const flex = flexByRow?.[row] ?? 0;
          const old = foldTravel(previous.nx * x + previous.ny * y - previous[key] - previous.flex * flex,
            flat ? 0 : previous.radius);
          const next = foldTravel(candidate.nx * x + candidate.ny * y - candidate[key] - candidate.flex * flex,
            flat ? 0 : candidate.radius);
          max = Math.max(max, Math.hypot(candidate.nx * next - previous.nx * old, candidate.ny * next - previous.ny * old));
        }
      }
      return max;
    }
    const pending = flex === target.flex ? target : { ...target, flex };
    if (movement(pending) <= maxMotion) {
      previous = { ...pending, wave, moving: lifting || wave !== wantedWave || flex !== wantedFlex };
      return previous;
    }

    // Even if the closest crease changes abruptly, move through feasible intermediate folds.
    const oldAngle = Math.atan2(previous.ny, Math.abs(previous.nx));
    const newAngle = Math.atan2(target.ny, Math.abs(target.nx));
    const offset = p => (p.nx * paper.w + p.ny * paper.h) / 2 - p[key];
    const oldOffset = offset(previous);
    const newOffset = offset(target);
    let low = 0;
    let high = 1;
    let next = previous;
    for (let i = 0; i < 12; i++) {
      const t = (low + high) / 2;
      const angle = oldAngle + (newAngle - oldAngle) * t;
      const nx = side * Math.cos(angle);
      const ny = Math.sin(angle);
      const radius = previous.radius + (target.radius - previous.radius) * t;
      const axis = Math.max(minimumFoldAxis(paper, height, nx, ny, flat ? 0 : radius, zoomed),
        (nx * paper.w + ny * paper.h) / 2 - oldOffset - (newOffset - oldOffset) * t);
      const candidate = { ...target, nx, ny, radius, flex, [key]: axis };
      if (movement(candidate) <= maxMotion) {
        low = t;
        next = candidate;
      } else {
        high = t;
      }
    }
    if (!low) next = { ...previous, [key]: previous[key] + maxMotion / 2 };
    previous = { ...next, wave, waveCenter: target.waveCenter, overhang: target.overhang, moving: true };
    return previous;
  };
}

function paperArc(span, start, end) {
  if (Math.abs(end - start) < .0001) return { x: span * Math.cos(start), z: span * Math.sin(start) };
  const radius = span / (end - start);
  return { x: radius * (Math.sin(end) - Math.sin(start)), z: radius * (Math.cos(start) - Math.cos(end)) };
}

function centerRoll(reach, width, angle, tip = -looseTip * Math.sin(angle), contact = 0, rootFraction = rootLength) {
  // Each arc uses the sheet's original length. After contact, the resting part continues flat.
  const root = width * rootFraction * (1 - smoothStep(.08, 1.24, angle));
  if (reach <= root) return { x: reach, z: 0, angle: 0 };
  reach -= root;
  width -= root;
  const bend = rollBend * width * Math.sin(angle);
  if (reach < bend) {
    const local = angle * reach / bend;
    const arc = paperArc(reach, 0, local);
    return { x: root + arc.x, z: arc.z, angle: local };
  }
  const base = paperArc(bend, 0, angle);
  const available = width - bend;
  const outside = Math.max(0, reach - bend);
  if (contact <= 0 || angle <= 2.20) {
    const local = angle + tip * outside / available;
    const edge = paperArc(outside, angle, local);
    return { x: root + base.x + edge.x, z: base.z + edge.z, angle: local };
  }
  const blend = contact * smoothStep(2.20, 2.72, angle);
  const heldMiddle = angle + .48 * tip;
  const middle = heldMiddle + (Math.PI + Math.min(.95, 2.35 * (Math.PI - angle)) - heldMiddle) * blend;
  let end = angle + tip + (Math.PI - angle - tip) * blend;
  const firstDrop = paperArc(.48, angle, middle).z;
  const floorGap = base.z + available * (firstDrop + paperArc(.52, middle, Math.PI).z);
  const flatten = smoothStep(0, .16, contact) * (1 - smoothStep(0, width * .07, floorGap));
  end += (Math.PI - end) * flatten;
  const drop = firstDrop + paperArc(.52, middle, end).z;
  let moving = available;
  if (drop < -.000001 && base.z + available * drop < 0) {
    moving = Math.min(available, base.z / -drop);
  }
  const first = Math.min(outside, moving * .48);
  const second = Math.min(outside - first, moving * .52);
  const a = angle + (middle - angle) * first / Math.max(.0001, moving * .48);
  const b = middle + (end - middle) * second / Math.max(.0001, moving * .52);
  const near = paperArc(first, angle, a);
  const far = paperArc(second, middle, b);
  return {
    x: root + base.x + near.x + far.x - Math.max(0, outside - moving),
    z: base.z + near.z + far.z,
    angle: second > 0 ? b : a
  };
}

function centerTurnAngle(reach, width, grip, wave, waveCenter, span, root) {
  const inward = Math.max(0, grip.inward);
  if (inward <= .008) return 0;
  // Very short pulls at the spine should lift the sheet before turning it over.
  const lever = Math.max(.28, reach);
  const travel = inward * smoothStep(.008, .12, inward) * Math.min(1, lever / .34);
  const position = (lever - travel) * width;
  const ripple = paperWave(lever * width, width, wave, waveCenter, span);
  let low = 0;
  let high = Math.PI;
  for (let i = 0; i < 15; i++) {
    const angle = (low + high) / 2;
    const roll = centerRoll(lever * width - ripple.loss, width, angle, undefined, 0, root);
    if (roll.x - ripple.lift * Math.sin(roll.angle) > position) low = angle;
    else high = angle;
  }
  return (low + high) / 2;
}

function paperWave(reach, width, wave, center, spanFraction = waveSpan) {
  const span = spanFraction * width;
  const t = clamp((reach - center * width) / span + .5, 0, 1);
  const peakSlope = Math.PI * wave / span;
  return {
    loss: .25 * peakSlope ** 2 * span * (t - Math.sin(4 * Math.PI * t) / (4 * Math.PI)),
    lift: wave * Math.sin(Math.PI * t) ** 2,
    slope: peakSlope * Math.sin(2 * Math.PI * t)
  };
}

function centerGripWeight(reach) {
  return smoothStep(.25, .43, reach) * (1 - smoothStep(.64, .82, reach));
}

function outsideGrip(side, grip) {
  return smoothStep(.76, .90, side > 0 ? grip.x : 1 - grip.x);
}

function sideGripWeight(side, grip) {
  return outsideGrip(side, grip) * (1 - .68 * smoothStep(.46, .97, Math.abs(2 * grip.y - 1)));
}

export function cornerGripWeight(side, grip) {
  return grip?.point ? outsideGrip(side, grip) * smoothStep(.52, .86, Math.abs(2 * grip.y - 1)) : 0;
}

export function isCenterGrip(side, grip) {
  if (!grip?.point) return false;
  const reach = side > 0 ? grip.x : 1 - grip.x;
  const rim = smoothStep(.50, .91, Math.abs(2 * grip.y - 1));
  return reach <= .725 + .10 * rim;
}

function heldGeometry(paper, side, grip, rest) {
  const { w, h } = paper;
  const weight = grip.weight ?? 1;
  const x = grip.x * w;
  const y = grip.y * h;
  const motion = smoothStep(.012, .12, Math.hypot(grip.inward, grip.vertical));
  const lift = w * (grip.cornerLift ?? (grip.held ? .043 : .016)) * (1 - motion * .91);
  const dx = Math.max(1, (paper.x + x - grip.point.x) * side + lift);
  const dy = paper.y + y - grip.point.y + (2 * grip.y - 1) * lift * (1 - motion);

  const length = Math.hypot(dx, dy);
  // Keep the crease from flipping steeply when a vertical pull changes direction.
  const steady = dx + w * .16 * sideGripWeight(side, grip) * smoothStep(.002, .055, Math.abs(grip.vertical)) * weight;
  const heldLength = Math.hypot(steady, dy);
  const heldNx = side * steady / heldLength;
  const heldNy = dy / heldLength;
  const anchor = heldNx * x + heldNy * y;
  const curl = Math.hypot(grip.inward * w, grip.vertical * h) / w;
  const radius = w * (.013 + .055 * smoothStep(0, .54, curl + lift / w));
  const travel = length * (1 - .045 * smoothStep(.42, .95, length / w));
  const reach = side > 0 ? grip.x : 1 - grip.x;
  const middle = centerGripWeight(reach);
  const turning = smoothStep(.025, .32, grip.inward);
  const curlWeight = 1 - middle * (1 - turning);
  const raised = grip.held ? 1 : smoothStep(.008, .12, curl);
  const liftWave = w * .073 * raised * (1 - smoothStep(.09, .33, grip.inward)) * weight;
  if (isCenterGrip(side, grip)) {
    // A grip near the spine lifts a shorter section and keeps the binding fixed.
    const span = clamp(reach * 1.85, .12, waveSpan);
    const root = Math.min(rootLength, reach * .72);
    const wave = liftWave * Math.max(.68, middle) * (span / waveSpan);
    const drift = .105 * smoothStep(.02, .30, grip.inward) * (span / waveSpan);
    const half = span / 2 + .01;
    const waveCenter = clamp(reach - drift, half, 1 - half);
    const waveLean = clamp((.5 - grip.y) * .38 + grip.vertical * .68, -.24, .24);
    return { ...rest, overhang: weight, wave, waveCenter, waveLean, waveSpan: span, centerRoot: root,
      centerTurn: centerTurnAngle(reach, w, grip, wave, waveCenter, span, root) };
  }
  const waveCenter = clamp(reach, .23, .77);
  const far = Math.max(0, heldNx * w) + Math.max(0, heldNy * h);
  const flatOffset = far - anchor;
  const heldOffset = flatOffset + (-pullAxis(travel, radius) - flatOffset) * curlWeight;
  const heldCrease = flatOffset + (-travel / 2 - flatOffset) * curlWeight;

  const mix = (a, b) => a + (b - a) * weight;
  const nx = mix(rest.nx, heldNx);
  const ny = mix(rest.ny, heldNy);
  const normalLength = Math.hypot(nx, ny);
  const restAnchor = rest.nx * x + rest.ny * y;
  const offset = mix(rest.axis - restAnchor, heldOffset);
  const crease = mix(rest.crease - restAnchor, heldCrease);
  return {
    ...rest, nx: nx / normalLength, ny: ny / normalLength,
    axis: (nx * x + ny * y) / normalLength + offset,
    crease: (nx * x + ny * y) / normalLength + crease,
    radius: mix(rest.radius, radius), overhang: weight, wave: liftWave * middle, waveCenter
  };
}

function foldGeometry(paper, side, progress, tilt, grip, mesh = false) {
  const release = grip?.release ?? 0;
  const corner = !mesh && release > 0 ? cornerGripWeight(side, grip) *
    smoothStep(0, .36, release) * (1 - smoothStep(.43, .86, release)) : 0;
  const slope = (tilt + ((grip?.y ?? .5) - .5) * .28 * corner) * (1 - progress) ** .8;
  const length = Math.hypot(1, slope);
  const nx = side / length;
  const ny = slope / length;
  const far = Math.max(0, nx * paper.w) + Math.max(0, ny * paper.h);
  const near = Math.min(0, nx * paper.w) + Math.min(0, ny * paper.h);
  const taper = mesh ? (grip?.taper ?? 0) * (grip?.weight ?? 1) : 0;
  const flex = paper.w * (mesh && grip ? .18 * (grip.weight ?? 1) *
    smoothStep(0, .19, progress) * (1 - smoothStep(.43, .86, progress)) : .042 * corner);
  const radius = Math.max(.7, paper.w * (.003 + (mesh ? .14 : .095) * Math.sin(progress * Math.PI) + .014 * corner));
  let axis = far + (near - far - radius * .85) * progress;
  if (mesh && grip && !grip.reverse) {
    const outer = side > 0 ? Math.max(.56, grip.x) : Math.min(.44, grip.x);
    const anchor = nx * outer * paper.w + ny * grip.y * paper.h;
    const distance = Math.max(0, Math.abs(nx) * (grip.inward + grip.lift * .37) * paper.w -
      ny * grip.vertical * paper.h);
    const localRadius = radius * (1 + .44 * taper * (2 * grip.y - 1));
    const heldAxis = Math.max(near, anchor - pullAxis(distance, localRadius));
    const weight = (grip.weight ?? 1) * smoothStep(0, .10, progress) * (1 - smoothStep(.52, .86, progress));
    axis += (heldAxis - axis) * weight;
  }
  const rest = { nx, ny, axis, radius, taper, flex, crease: axis + radius * (.3 - .8 * progress), overhang: 0 };
  return !mesh && grip?.point ? heldGeometry(paper, side, grip, rest) : rest;
}

function makeMesh(gl, adaptive) {
  const columns = 96;
  const rows = 60;
  const vertices = [];
  const indices = [];
  for (let y = 0; y <= rows; y++) {
    for (let x = 0; x <= columns; x++) {
      const u = x / columns;
      vertices.push(adaptive ? .5 - .5 * Math.cos(u * Math.PI) : u, y / rows);
      if (x === columns || y === rows) continue;
      const top = y * (columns + 1) + x;
      const bottom = top + columns + 1;
      indices.push(top, bottom, top + 1, top + 1, bottom, bottom + 1);
    }
  }
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(indices), gl.STATIC_DRAW);
  return { vertices: new Float32Array(vertices), length: indices.length };
}

export function createCurl(canvas, { mesh = false, adaptive = false } = {}) {
  const gl = canvas.getContext('webgl', {
    alpha: true, antialias: adaptive, premultipliedAlpha: false, preserveDrawingBuffer: true
  });
  if (!gl || gl.isContextLost()) return null;
  const program = gl.createProgram();
  const useMesh = mesh || adaptive;
  gl.attachShader(program, shader(gl, gl.VERTEX_SHADER, useMesh ? meshVertexSource : vertexSource));
  gl.attachShader(program, shader(gl, gl.FRAGMENT_SHADER, useMesh ? meshFragmentSource : fragmentSource));
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
  gl.useProgram(program);
  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  const grid = useMesh ? makeMesh(gl, adaptive) : null;
  gl.bufferData(gl.ARRAY_BUFFER, grid?.vertices ?? new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  const position = gl.getAttribLocation(program, 'aVertex');
  gl.enableVertexAttribArray(position);
  gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
  const uniforms = {};
  for (const name of ['Stage', 'Page', 'Normal', 'Axis', 'Radius', 'Progress', 'HasBack', 'Bound',
    'Spine', 'SpineSide', 'Front', 'Back', 'FrontRegion', 'BackRegion', 'Taper', 'GripY', 'Flex', 'ShadowPass',
    'Overhang', 'Adaptive', 'Wave', 'WaveLean', 'CenterTurn', 'CenterRoot', 'CenterFlex', 'CenterCorners']) {
    uniforms[name] = gl.getUniformLocation(program, 'u' + name);
  }

  const textures = [gl.createTexture(), gl.createTexture()];
  const loaded = [null, null];
  function upload(source, unit) {
    if (loaded[unit] === source) return;
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, textures[unit]);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    loaded[unit] = source;
  }

  function begin({ width, height, paper, back, side, bound, zoomed }) {
    if (gl.isContextLost()) return null;
    const scale = pageScale(width, height);
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    gl.viewport(0, 0, canvas.width, canvas.height);
    const front = pageRaster(paper, scale).source;
    upload(front, 0);
    upload(back?.image ? pageRaster(back, scale).source : front, 1);
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
    gl.uniform1f(uniforms.Adaptive, adaptive ? 1 : 0);
    for (const [name, half] of [['FrontRegion', paper.half], ['BackRegion', back?.half]]) {
      gl.uniform2f(uniforms[name], (half ?? 0) / 2, half === undefined ? 1 : .5);
    }
    canvas.hidden = false;
    const track = adaptive ? trackFold(width, height, zoomed) : null;

    return function draw(progress, tilt, geometry = paper, grip, time) {
      const pose = track ? track(geometry, side, progress, tilt, grip, time) :
        foldGeometry(geometry, side, progress, tilt, grip, mesh);
      const { nx, ny, axis, radius, taper, flex, overhang, wave, waveCenter, waveLean,
        waveSpan: span, centerTurn, centerRoot, tip, skew, contact, lead, upperDelay, lowerDelay, moving } = pose;
      gl.uniform4f(uniforms.Page, geometry.x, geometry.y, geometry.w, geometry.h);
      gl.uniform1f(uniforms.Spine, geometry.spine ?? (paper.side !== 'single' && paper.half === undefined ? 1 : 0));
      gl.uniform2f(uniforms.Normal, nx, ny);
      gl.uniform1f(uniforms.Radius, radius);
      gl.uniform1f(uniforms.Axis, axis);
      gl.uniform1f(uniforms.Progress, Math.max(progress, .12 * overhang));
      gl.uniform2f(uniforms.Overhang, overhang, adaptive ? 1 : overhang);
      if (grid) {
        gl.enable(gl.DEPTH_TEST);
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
        gl.uniform1f(uniforms.Taper, taper);
        gl.uniform1f(uniforms.GripY, grip?.y ?? .5);
        gl.uniform1f(uniforms.Flex, flex);
        gl.uniform3f(uniforms.Wave, wave ?? 0, waveCenter ?? .5, span ?? waveSpan);
        gl.uniform1f(uniforms.WaveLean, waveLean ?? 0);
        gl.uniform1f(uniforms.CenterTurn, centerTurn ?? -1);
        gl.uniform1f(uniforms.CenterRoot, centerRoot ?? rootLength);
        gl.uniform4f(uniforms.CenterFlex, tip ?? 0, skew ?? 0, contact ?? 0, lead ?? 0);
        gl.uniform2f(uniforms.CenterCorners, upperDelay ?? 0, lowerDelay ?? 0);
        gl.uniform1f(uniforms.ShadowPass, 1);
        gl.drawElements(gl.TRIANGLES, grid.length, gl.UNSIGNED_SHORT, 0);
        gl.clear(gl.DEPTH_BUFFER_BIT);
        gl.uniform1f(uniforms.ShadowPass, 0);
        gl.drawElements(gl.TRIANGLES, grid.length, gl.UNSIGNED_SHORT, 0);
      } else {
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      }
      return moving;
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
    begin({ width, height, paper, back, side, bound, adaptive, zoomed }) {
      const scale = pageScale(width, height);
      canvas.width = Math.max(1, Math.round(width * scale));
      canvas.height = Math.max(1, Math.round(height * scale));
      const front = { ...pageRaster(paper, scale), half: paper.half };
      const reverse = back?.image ? { ...pageRaster(back, scale), half: back.half } : null;
      let w, h, corners;
      canvas.hidden = false;
      const track = adaptive ? trackFold(width, height, zoomed, true) : null;

      function tint(left, top, width, height, shade) {
        if (Math.abs(shade) < .001) return;
        ctx.fillStyle = shade < 0 ? `rgba(255, 255, 255, ${-shade * .45})` : `rgba(0, 0, 0, ${shade})`;
        ctx.fillRect(left, top, width, height);
      }

      function paint({ source, width, height, half }, wave, center, face = side) {
        const sourceWidth = half === undefined ? width : width / 2;
        const sourceX = (half ?? 0) * sourceWidth;
        if (!wave) {
          ctx.drawImage(source, sourceX, 0, sourceWidth, height, 0, 0, w, h);
          return;
        }
        const strips = 26;
        const ripple = x => paperWave(face > 0 ? x : w - x, w, wave, center);
        const projected = x => x - face * ripple(x).loss;
        for (let i = 0; i < strips; i++) {
          const x = w * i / strips;
          const left = projected(x);
          const width = projected(w * (i + 1) / strips) - left;
          const slope = face * ripple(x + w / (2 * strips)).slope;
          const shade = clamp(.60 * slope + .18 * slope ** 2, -.18, .34);
          ctx.drawImage(source, sourceX + sourceWidth * i / strips, 0, sourceWidth / strips, height,
            left, 0, width + .4, h);
          tint(left, 0, width + .4, h, shade);
        }
      }

      function paintCenter(pose, pageY, gripY) {
        const count = 42;
        const spine = side > 0 ? 0 : w;
        const topLimit = Math.min(0, 1 - pageY);
        const bottomLimit = Math.max(h, height - pageY - 1);
        const profile = v => .44 * v + .56 * smoothStep(0, 1, v);
        const gripProfile = profile(gripY);
        function project(u, v) {
          const reach = (side > 0 ? u : 1 - u) * w;
          const row = v - gripY;
          const wave = (pose.wave ?? 0) * (1 - .56 * smoothStep(.04, .77, Math.abs(row)));
          const span = pose.waveSpan ?? waveSpan;
          const center = clamp((pose.waveCenter ?? .5) + row * (pose.waveLean ?? 0), span / 2, 1 - span / 2);
          const ripple = paperWave(reach, w, wave, center, span);
          const lead = (pose.lead ?? 0) * smoothStep(0, .72, Math.abs(row));
          const turn = clamp(pose.centerTurn + (pose.skew ?? 0) * (profile(v) - gripProfile) + lead, 0, Math.PI);
          const delay = (pose.upperDelay ?? 0) * smoothStep(cornerContactStart, 1, 1 - v) +
            (pose.lowerDelay ?? 0) * smoothStep(cornerContactStart, 1, v);
          const roll = centerRoll(reach - ripple.loss, w, turn, pose.tip, pose.contact * (1 - delay), pose.centerRoot);
          const z = Math.max(0, roll.z + ripple.lift * Math.cos(roll.angle));
          return {
            x: spine + side * (roll.x - ripple.lift * Math.sin(roll.angle)),
            y: clamp(v * h + (v - .42) * Math.min(18, z * .12) + (v - .28) * ripple.lift * .36,
              topLimit, bottomLimit),
            z, angle: roll.angle, slope: side * ripple.slope * Math.cos(roll.angle)
          };
        }

        const bands = pose.wave || pose.skew || pose.lead || pose.upperDelay || pose.lowerDelay ? 14 : 1;
        const edge = v => Array.from({ length: count + 1 }, (_, i) => project(i / count, v));
        let top = edge(0);
        for (let band = 0; band < bands; band++) {
          const bottom = edge((band + 1) / bands);
          const strips = [];
          for (let i = 0; i < count; i++) {
            const [a, b, c, d] = [top[i], top[i + 1], bottom[i], bottom[i + 1]];
            const dx = (b.x - a.x + d.x - c.x) / 2;
            if (Math.abs(dx) < .04) continue;
            const dy = (b.y - a.y + d.y - c.y) / 2;
            strips.push({
              i, dx, dy, x: (a.x + b.x - dx) / 2, y: (a.y + b.y - dy) / 2,
              shift: (c.x + d.x - a.x - b.x) / 2, rise: (c.y + d.y - a.y - b.y) / 2,
              z: (a.z + b.z + c.z + d.z) / 4, angle: (a.angle + b.angle + c.angle + d.angle) / 4,
              slope: (a.slope + b.slope + c.slope + d.slope) / 4
            });
          }
          strips.sort((a, b) => a.z - b.z);
          for (const strip of strips) {
            const flipped = strip.dx < 0;
            const page = (flipped && reverse) || front;
            const mirrored = flipped && page === reverse;
            const sourceWidth = page.width * (page.half === undefined ? 1 : .5);
            const u = mirrored ? count - 1 - strip.i : strip.i;
            const sourceX = ((page.half ?? 0) + u / count) * sourceWidth;
            const sourceHeight = page.height / bands;
            const width = 1 + Math.min(.15, .55 / Math.abs(strip.dx));
            const height = band + 1 === bands ? 1 : 1 + .55 / Math.max(1, strip.rise);
            ctx.save();
            ctx.transform(strip.dx, strip.dy, strip.shift, strip.rise, strip.x, strip.y);
            if (flipped && !reverse) {
              ctx.fillStyle = '#e6e6e6';
              ctx.fillRect(0, 0, width, height);
              ctx.globalAlpha = .14;
            }
            if (mirrored) ctx.transform(-1, 0, 0, 1, width, 0);
            ctx.drawImage(page.source, sourceX, sourceHeight * band, sourceWidth / count, sourceHeight, 0, 0, width, height);
            ctx.globalAlpha = 1;
            const turnShade = (flipped ? .17 : .32) * Math.sin(strip.angle) ** 2;
            const shade = clamp(turnShade + .60 * strip.slope + .18 * strip.slope ** 2, -.18, .62);
            tint(0, 0, width, height, shade);
            ctx.restore();
          }
          top = bottom;
        }
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

      return (progress, tilt, geometry = paper, grip, time) => {
        ({ w, h } = geometry);
        corners = [[0, 0], [w, 0], [w, h], [0, h]];
        const tracked = track ? track(geometry, side, progress, tilt, grip, time) :
          foldGeometry(geometry, side, progress, tilt, grip);
        const { nx, ny, radius, crease, overhang, wave, waveCenter, centerTurn, moving } = tracked;
        ctx.setTransform(scale, 0, 0, scale, 0, 0);
        ctx.clearRect(0, 0, width, height);
        ctx.save();
        ctx.translate(geometry.x, geometry.y);
        if (!bound && !overhang) {
          ctx.beginPath();
          ctx.rect(0, adaptive ? -geometry.y : 0, w, adaptive ? height : h);
          ctx.clip();
        }
        if (centerTurn !== undefined) {
          paintCenter(tracked, geometry.y, grip.y);
        } else {
          ctx.save();
          clip(nx, ny, crease, 1);
          foldShade(nx, ny, crease, radius * 2.6, [[0, '#0007'], [.35, '#0003'], [1, '#0000']]);
          ctx.restore();

          ctx.save();
          clip(nx, ny, crease, -1);
          paint(front, wave, waveCenter);
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
          ctx.globalAlpha = reverse ? 1 : .15;
          paint(reverse || front, wave, waveCenter, -side);
          ctx.restore();
          foldShade(nx, ny, crease, radius * 2.2, [[0, '#0008'], [.25, '#fff6'], [1, '#fff0']]);
          ctx.restore();
        }
        ctx.restore();
        if (!bound && overhang > 0 && overhang < 1) {
          ctx.save();
          ctx.globalCompositeOperation = 'destination-out';
          ctx.globalAlpha = 1 - overhang;
          ctx.beginPath();
          ctx.rect(0, 0, width, height);
          ctx.rect(geometry.x, adaptive ? 0 : geometry.y, w, adaptive ? height : h);
          ctx.fill('evenodd');
          ctx.restore();
        }
        return moving;
      };
    }
  };
}
