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
const looseTip = .28;

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
  uniform vec2 uWave;
  uniform float uCenterTurn;
  uniform vec3 uCenterFlex;
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
    float bend = ${rollBend} * width * max(0.0, sin(turn));
    if (reach < bend) {
      float angle = turn * reach / bend;
      return vec3(paperArc(reach, 0.0, angle), angle);
    }
    vec2 base = paperArc(bend, 0.0, turn);
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

  void main() {
    vUV = aVertex;
    vec2 point = aVertex * uPage.zw;
    float ripple = 0.0;
    vWaveSlope = 0.0;
    if (uWave.x > 0.0) {
      float span = ${waveSpan} * uPage.z;
      float reach = uSpineSide > 0.0 ? point.x : uPage.z - point.x;
      float t = clamp((reach - uWave.y * uPage.z) / span + .5, 0.0, 1.0);
      float peakSlope = PI * uWave.x / span;
      // Integrating the horizontal projection keeps the raised paper from stretching sideways.
      float loss = .25 * peakSlope * peakSlope * span * (t - sin(4.0 * PI * t) / (4.0 * PI));
      point.x -= uSpineSide * loss;
      float rise = sin(PI * t);
      ripple = uWave.x * rise * rise;
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
      float row = mix(aVertex.y, smoothstep(0.0, 1.0, aVertex.y), .68) - .5;
      float rowTurn = clamp(uCenterTurn + uCenterFlex.y * row, 0.0, PI);
      vec3 rolled = turnSection(reach, uPage.z, rowTurn, uCenterFlex.x, uCenterFlex.z);
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

function minimumFoldAxis(paper, height, nx, ny, radius) {
  const edge = nx > 0 ? paper.w : 0;
  const hinge = nx * (paper.w - edge) + Math.max(0, ny * paper.h);
  if (!ny) return hinge;
  const firstRoom = Math.max(0, paper.y - 1);
  const lastRoom = Math.max(0, height - 1 - paper.y - paper.h);
  const room = ny > 0 ? firstRoom : lastRoom;
  // The vertical extrema of the cylinder projection occur at the sheet corners.
  const first = nx * edge - pullAxis((ny > 0 ? room : room + paper.h) / Math.abs(ny), radius);
  const last = nx * edge + ny * paper.h - pullAxis((ny > 0 ? room + paper.h : room) / Math.abs(ny), radius);
  return Math.max(hinge, first, last);
}

function constrainFold(paper, pose, height, grip, flat = false) {
  const side = Math.sign(pose.nx);
  const edge = side > 0 ? paper.w : 0;
  const key = flat ? 'crease' : 'axis';
  const radius = flat ? 0 : pose.radius;
  const axis = minimumFoldAxis(paper, height, pose.nx, pose.ny, radius);
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
    const limit = minimumFoldAxis(paper, height, nx, ny, radius);
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
    const gravity = 38 * Math.max(0, Math.cos(remaining)) * smoothStep(.02, .48, remaining);
    const damping = 29 + 8 * (1 - smoothStep(.07, .51, remaining));
    state.speed = Math.max(0, state.speed + (254 * remaining + gravity - damping * state.speed) * step);
    state.angle += direction * Math.min(remaining, state.speed * step);
    left -= step;
  }
  if (Math.abs(target - state.angle) < .009 && state.speed < .24) {
    state.angle = target;
    state.speed = 0;
  }
}

function trackFold(height, flat = false) {
  const key = flat ? 'crease' : 'axis';
  const points = [0, .25, .5, .75, 1];
  let previous;
  let previousTime;
  let previousPoint;
  let momentum = 0;
  let centerVelocity = 0;
  let centerRelease;

  return (paper, pose, grip, time) => {
    const target = pose.centerTurn === undefined ? constrainFold(paper, pose, height, grip, flat) : pose;
    if (!previous) {
      previous = target;
      previousTime = time;
      previousPoint = grip?.point;
      return target;
    }
    const point = grip?.point;
    const drag = point && previousPoint ? Math.hypot(point.x - previousPoint.x, point.y - previousPoint.y) : 0;
    const interval = time - previousTime;
    const elapsed = clamp(interval, 1, 28);
    momentum = Math.max(momentum * Math.exp(-elapsed / 24), clamp((drag - 6) * 4.5, 0, 150));
    const maxMotion = elapsed * 1.4 + momentum;
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
      const touch = clamp(grip.vertical * 1.3 + (.5 - grip.y) * .42, -.22, .22);
      let centerTurn;
      let moving;
      if (grip.release !== undefined) {
        const end = grip.finish ? Math.PI : 0;
        if (!centerRelease) {
          const toward = grip.finish ? 1 : -1;
          centerRelease = { angle: before, speed: interval < 80 ? clamp(centerVelocity * toward * 1000, 0, 12) : 0 };
        } else {
          advanceCenterTurn(centerRelease, end, Math.min(.048, interval / 1000));
        }
        centerTurn = centerRelease.angle;
        moving = centerTurn !== end;
      } else {
        const limit = elapsed * .0075 + momentum * .0015;
        const delta = target.centerTurn - before;
        centerTurn = Math.abs(delta) <= limit ? target.centerTurn : before + Math.sign(delta) * limit;
        centerVelocity = (centerTurn - before) / elapsed;
        moving = centerTurn !== target.centerTurn;
      }
      const contact = grip.finish ? smoothStep(0, .28, timeReleased) : 0;
      const tip = -looseTip * Math.sin(centerTurn);
      const landing = contact * smoothStep(2.24, 2.76, centerTurn) * Math.min(.32, (Math.PI - centerTurn) * 1.1);
      const skew = touch * Math.sin(centerTurn) * (1 - timeReleased) + (touch < 0 ? -1 : 1) * landing;
      previous = { ...target, centerTurn, wave, tip, skew, contact, moving: wave !== wantedWave || moving };
      return previous;
    }
    const oldLimit = minimumFoldAxis(paper, height, previous.nx, previous.ny, flat ? 0 : previous.radius);
    if (previous[key] < oldLimit) previous = { ...previous, [key]: oldLimit };
    function movement(candidate) {
      let max = 0;
      for (const u of points) {
        const x = paper.w * u;
        for (const v of points) {
          const y = paper.h * v;
          const old = foldTravel(previous.nx * x + previous.ny * y - previous[key], flat ? 0 : previous.radius);
          const next = foldTravel(candidate.nx * x + candidate.ny * y - candidate[key], flat ? 0 : candidate.radius);
          max = Math.max(max, Math.hypot(candidate.nx * next - previous.nx * old, candidate.ny * next - previous.ny * old));
        }
      }
      return max;
    }
    if (movement(target) <= maxMotion) {
      previous = { ...target, wave, moving: wave !== wantedWave };
      return previous;
    }

    // Even if the closest crease changes abruptly, move through feasible intermediate folds.
    const oldAngle = Math.atan2(previous.ny, Math.abs(previous.nx));
    const newAngle = Math.atan2(target.ny, Math.abs(target.nx));
    const side = Math.sign(target.nx);
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
      const axis = Math.max(minimumFoldAxis(paper, height, nx, ny, flat ? 0 : radius),
        (nx * paper.w + ny * paper.h) / 2 - oldOffset - (newOffset - oldOffset) * t);
      const candidate = { ...target, nx, ny, radius, [key]: axis };
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

function centerRoll(reach, width, angle, tip = -looseTip * Math.sin(angle), contact = 0) {
  // Each arc uses the sheet's original length. After contact, the resting part continues flat.
  const bend = rollBend * width * Math.sin(angle);
  if (reach < bend) {
    const local = angle * reach / bend;
    return { ...paperArc(reach, 0, local), angle: local };
  }
  const base = paperArc(bend, 0, angle);
  const available = width - bend;
  const outside = Math.max(0, reach - bend);
  if (contact <= 0 || angle <= 2.20) {
    const local = angle + tip * outside / available;
    const edge = paperArc(outside, angle, local);
    return { x: base.x + edge.x, z: base.z + edge.z, angle: local };
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
    x: base.x + near.x + far.x - Math.max(0, outside - moving),
    z: base.z + near.z + far.z,
    angle: second > 0 ? b : a
  };
}

function centerTurnAngle(reach, width, grip) {
  const inward = Math.max(0, grip.inward);
  if (inward <= .008) return 0;
  const position = (reach - inward * smoothStep(.008, .12, inward)) * width;
  let low = 0;
  let high = Math.PI;
  for (let i = 0; i < 15; i++) {
    const angle = (low + high) / 2;
    if (centerRoll(reach * width, width, angle).x > position) low = angle;
    else high = angle;
  }
  return (low + high) / 2;
}

function paperWave(reach, width, wave, center) {
  const span = waveSpan * width;
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

export function isCenterGrip(side, grip) {
  return Boolean(grip?.point && centerGripWeight(side > 0 ? grip.x : 1 - grip.x) >= .55);
}

function heldGeometry(paper, side, grip, rest) {
  const { w, h } = paper;
  const weight = grip.weight ?? 1;
  const x = grip.x * w;
  const y = grip.y * h;
  const motion = smoothStep(.012, .12, Math.hypot(grip.inward, grip.vertical));
  const lift = w * (grip.held ? .043 : .016) * (1 - motion * .91);
  const dx = Math.max(1, (paper.x + x - grip.point.x) * side + lift);
  const dy = paper.y + y - grip.point.y + (2 * grip.y - 1) * lift * (1 - motion);

  const length = Math.hypot(dx, dy);
  const heldNx = side * dx / length;
  const heldNy = dy / length;
  const anchor = heldNx * x + heldNy * y;
  const curl = Math.hypot(grip.inward * w, grip.vertical * h) / w;
  const radius = w * (.013 + .055 * smoothStep(0, .54, curl + lift / w));
  const travel = length * (1 - .045 * smoothStep(.42, .95, length / w));
  const reach = side > 0 ? grip.x : 1 - grip.x;
  const middle = centerGripWeight(reach);
  const turning = smoothStep(.025, .32, grip.inward);
  const curlWeight = 1 - middle * (1 - turning);
  const raised = grip.held ? 1 : smoothStep(.008, .12, curl);
  const wave = w * .073 * middle * raised * (1 - smoothStep(.09, .33, grip.inward)) * weight;
  const waveCenter = clamp(reach, .23, .77);
  if (middle >= .55) {
    return { ...rest, overhang: weight, wave, waveCenter, centerTurn: centerTurnAngle(reach, w, grip) };
  }
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
    radius: mix(rest.radius, radius), overhang: weight, wave, waveCenter
  };
}

function foldGeometry(paper, side, progress, tilt, grip, mesh = false) {
  const slope = tilt * (1 - progress) ** .8;
  const length = Math.hypot(1, slope);
  const nx = side / length;
  const ny = slope / length;
  const far = Math.max(0, nx * paper.w) + Math.max(0, ny * paper.h);
  const near = Math.min(0, nx * paper.w) + Math.min(0, ny * paper.h);
  const taper = mesh ? (grip?.taper ?? 0) * (grip?.weight ?? 1) : 0;
  const flex = mesh && grip ? paper.w * .18 * (grip.weight ?? 1) *
    smoothStep(0, .19, progress) * (1 - smoothStep(.43, .86, progress)) : 0;
  const radius = Math.max(.7, paper.w * (.003 + (mesh ? .14 : .095) * Math.sin(progress * Math.PI)));
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
    'Overhang', 'Adaptive', 'Wave', 'CenterTurn', 'CenterFlex']) {
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
    gl.uniform1f(uniforms.Adaptive, adaptive ? 1 : 0);
    for (const [name, half] of [['FrontRegion', paper.half], ['BackRegion', back?.half]]) {
      gl.uniform2f(uniforms[name], (half ?? 0) / 2, half === undefined ? 1 : .5);
    }
    canvas.hidden = false;
    const track = adaptive ? trackFold(height) : null;

    return function draw(progress, tilt, geometry = paper, grip, time) {
      const pose = foldGeometry(geometry, side, progress, tilt, grip, mesh);
      const { nx, ny, axis, radius, taper, flex, overhang, wave, waveCenter, centerTurn, tip, skew, contact, moving } = track
        ? track(geometry, pose, grip, time) : pose;
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
        gl.uniform2f(uniforms.Wave, wave ?? 0, waveCenter ?? .5);
        gl.uniform1f(uniforms.CenterTurn, centerTurn ?? -1);
        gl.uniform3f(uniforms.CenterFlex, tip ?? 0, skew ?? 0, contact ?? 0);
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
    begin({ width, height, paper, back, side, bound, adaptive }) {
      const scale = Math.min(window.devicePixelRatio, 1.35, 1800 / width, 1250 / height);
      canvas.width = Math.max(1, Math.round(width * scale));
      canvas.height = Math.max(1, Math.round(height * scale));
      let w, h, corners;
      canvas.hidden = false;
      const track = adaptive ? trackFold(height, true) : null;

      function tint(left, top, width, height, shade) {
        if (Math.abs(shade) < .001) return;
        ctx.fillStyle = shade < 0 ? `rgba(255, 255, 255, ${-shade * .45})` : `rgba(0, 0, 0, ${shade})`;
        ctx.fillRect(left, top, width, height);
      }

      function paint({ image, half }, wave, center, face = side) {
        const sourceWidth = half === undefined ? image.naturalWidth : image.naturalWidth / 2;
        const sourceX = (half ?? 0) * sourceWidth;
        if (!wave) {
          ctx.drawImage(image, sourceX, 0, sourceWidth, image.naturalHeight, 0, 0, w, h);
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
          ctx.drawImage(image, sourceX + sourceWidth * i / strips, 0, sourceWidth / strips, image.naturalHeight,
            left, 0, width + .4, h);
          tint(left, 0, width + .4, h, shade);
        }
      }

      function paintCenter(pose, pageY) {
        const count = 48;
        const spine = side > 0 ? 0 : w;
        const topLimit = Math.min(0, 1 - pageY);
        const bottomLimit = Math.max(h, height - pageY - 1);
        const strips = [];
        function project(u) {
          const reach = (side > 0 ? u : 1 - u) * w;
          const ripple = paperWave(reach, w, pose.wave ?? 0, pose.waveCenter ?? .5);
          const roll = centerRoll(reach - ripple.loss, w, pose.centerTurn, pose.tip, pose.contact);
          const z = Math.max(0, roll.z + ripple.lift * Math.cos(roll.angle));
          const perspective = Math.min(18, z * .12);
          return {
            x: spine + side * (roll.x - ripple.lift * Math.sin(roll.angle)),
            z, angle: roll.angle, slope: side * ripple.slope * Math.cos(roll.angle),
            top: Math.max(topLimit, -.42 * perspective - .28 * ripple.lift * .36),
            bottom: Math.min(bottomLimit, h + .58 * perspective + .72 * ripple.lift * .36)
          };
        }
        let first = project(0);
        for (let i = 0; i < count; i++) {
          const last = project((i + 1) / count);
          const mid = project((i + .5) / count);
          strips.push({ ...mid, left: Math.min(first.x, last.x), width: Math.abs(last.x - first.x),
            reverse: last.x < first.x, u: i / count });
          first = last;
        }
        strips.sort((a, b) => a.z - b.z);
        for (const strip of strips) {
          if (strip.width < .01) continue;
          const page = strip.reverse && back?.image ? back : paper;
          const sourceWidth = page.image.naturalWidth * (page.half === undefined ? 1 : .5);
          const u = strip.reverse && back?.image ? 1 - strip.u - 1 / count : strip.u;
          const sourceX = ((page.half ?? 0) + u) * sourceWidth;
          const height = strip.bottom - strip.top;
          ctx.save();
          if (strip.reverse && !back?.image) {
            ctx.fillStyle = '#e6e6e6';
            ctx.fillRect(strip.left, strip.top, strip.width + .4, height);
            ctx.globalAlpha = .14;
          }
          ctx.drawImage(page.image, sourceX, 0, sourceWidth / count, page.image.naturalHeight,
            strip.left, strip.top, strip.width + .4, height);
          ctx.restore();
          const turnShade = (strip.reverse ? .17 : .32) * Math.sin(strip.angle) ** 2;
          const shade = clamp(turnShade + .60 * strip.slope + .18 * strip.slope ** 2, -.18, .62);
          tint(strip.left, strip.top, strip.width + .4, height, shade);
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
        const pose = foldGeometry(geometry, side, progress, tilt, grip);
        const tracked = track ? track(geometry, pose, grip, time) : pose;
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
          paintCenter(tracked, geometry.y);
        } else {
          ctx.save();
          clip(nx, ny, crease, 1);
          foldShade(nx, ny, crease, radius * 2.6, [[0, '#0007'], [.35, '#0003'], [1, '#0000']]);
          ctx.restore();

          ctx.save();
          clip(nx, ny, crease, -1);
          paint(paper, wave, waveCenter);
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
          paint(back?.image ? back : paper, wave, waveCenter, -side);
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
