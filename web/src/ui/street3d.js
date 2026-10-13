// Level 4 in 3D: the junction as a small procedural street scene (three.js, loaded on demand
// from cdnjs). Same simulation as the 2D view, three cameras: orbit, the sensor mast's own
// view, and a driver following a connected vehicle with the signal advice it would receive.
// Buildings are procedural boxes, like the generated cities in BoundlessNYC, not real ones.

const THREE_URL = "https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js";
const HALF_M = 160; // metres of street shown each side of the junction
const LANE = 3.5;
const MEDIAN = 1.5;
const ROAD_HALF = 2 * LANE + MEDIAN / 2;
const SIDEWALK = 3;
const CAR_COLORS = [0xd8dde2, 0x2b2f36, 0x8a929c, 0x1f4e79, 0x7a1f24, 0xe6e1d3, 0x3f5e3a, 0x5a6470];

let loading = null;
/** Load three.js once; resolves to the THREE global. */
export function loadThree() {
  if (window.THREE) return Promise.resolve(window.THREE);
  loading ??= new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = THREE_URL;
    s.onload = () => resolve(window.THREE);
    s.onerror = () => reject(new Error("three.js could not be loaded"));
    document.head.append(s);
  });
  return loading;
}

/** Stable pseudo-random number in [0, 1) from a string, for procedural buildings. */
function hash(str) {
  let h = 0x811c9dc5;
  for (const ch of str) {
    h ^= ch.codePointAt(0);
    h = Math.imul(h, 0x01000193);
  }
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  return ((h ^ (h >>> 12)) >>> 0) / 4294967296;
}

const token = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

/** z of a lane centre: direction 1 on the far side (negative z), direction 0 near the camera. */
const laneZ = (d, lane) => (d === 1 ? -(MEDIAN / 2 + LANE * (lane === 0 ? 1.5 : 0.5)) : MEDIAN / 2 + LANE * (lane === 0 ? 1.5 : 0.5));

export class Street3D {
  constructor(THREE, host, sim, station) {
    this.T = THREE;
    this.host = host;
    this.sim = sim;
    this.station = station;
    this.st = sim.def.stations[station];
    this.mode = "orbit";
    this.orbit = { yaw: -0.55, pitch: 0.45, dist: 70 };
    this.cars = new Map();
    this.boxes = [];
    this.follow = null;

    const T = THREE;
    this.renderer = new T.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    this.canvas = this.renderer.domElement;
    this.canvas.className = "scene3d-canvas";
    this.canvas.setAttribute("role", "img");
    this.canvas.setAttribute("aria-label", `3D view of ${this.st.name}`);
    host.prepend(this.canvas);
    this.scene = new T.Scene();
    this.camera = new T.PerspectiveCamera(55, 2, 0.5, 2000);
    this.build();
    this.bindOrbit();
  }

  build() {
    const T = this.T;
    const sc = this.scene;
    const bg = new T.Color(token("--map-water") || "#0e161f");
    sc.background = bg;
    sc.fog = new T.Fog(bg, 180, 420);
    sc.add(new T.HemisphereLight(0xffffff, 0x445566, 0.85));
    const sun = new T.DirectionalLight(0xffffff, 0.7);
    sun.position.set(-60, 120, 80);
    sc.add(sun);

    const mat = (c, extra = {}) => new T.MeshLambertMaterial({ color: new T.Color(c), ...extra });
    const box = (w, h, d, m, x, y, z) => {
      const mesh = new T.Mesh(new T.BoxGeometry(w, h, d), m);
      mesh.position.set(x, y, z);
      sc.add(mesh);
      return mesh;
    };
    const land = token("--map-land") || "#1f2b38";
    const road = token("--road") || "#2c3640";
    const line = token("--road-line") || "#8a99a8";

    // Ground, roads, sidewalks, markings.
    box(2 * HALF_M + 200, 0.1, 600, mat(land), 0, -0.06, 0);
    box(2 * HALF_M, 0.05, 2 * ROAD_HALF, mat(road), 0, 0, 0);
    box(9, 0.05, 600, mat(road), 0, 0.005, 0); // side street
    const walk = mat(line, { transparent: true, opacity: 0.35 });
    for (const s of [-1, 1]) box(2 * HALF_M, 0.15, SIDEWALK, walk, 0, 0.05, s * (ROAD_HALF + SIDEWALK / 2));
    box(2 * HALF_M, 0.12, MEDIAN, mat(land), 0, 0.03, 0);
    const dash = mat(line);
    for (let x = -HALF_M; x < HALF_M; x += 9) {
      if (Math.abs(x) < 7) continue;
      for (const z of [laneZ(1, 0) + LANE / 2, laneZ(0, 1) + LANE / 2]) box(4, 0.06, 0.15, dash, x, 0.04, z);
    }
    // Stop lines (8 m before the junction centre in each direction).
    box(0.5, 0.07, 2 * LANE, dash, -8, 0.05, MEDIAN / 2 + LANE);
    box(0.5, 0.07, 2 * LANE, dash, 8, 0.05, -(MEDIAN / 2 + LANE));

    // Procedural buildings along both sides, leaving the side street open.
    const facade = [0x9aa3ad, 0xb7aa98, 0x8c8f86, 0xa7a29a, 0x7f8a93];
    for (const side of [-1, 1]) {
      let x = -HALF_M;
      let k = 0;
      while (x < HALF_M) {
        const seed = `${this.sim.def.id}|${this.station}|${side}|${k++}`;
        const w = 10 + hash(seed + "w") * 16;
        if (x + w > -9 && x < 9) {
          x = 9;
          continue;
        }
        const floors = 2 + Math.floor(hash(seed + "f") * 5);
        const depth = 12 + hash(seed + "d") * 10;
        const h = floors * 3.2;
        const z = side * (ROAD_HALF + SIDEWALK + 2 + depth / 2);
        box(w - 1, h, depth, mat(facade[Math.floor(hash(seed + "c") * facade.length)]), x + w / 2, h / 2, z);
        x += w;
      }
    }

    // Signal poles with a light that changes colour.
    this.lights = [];
    for (const [x, z] of [
      [-8, ROAD_HALF + 0.8],
      [8, -(ROAD_HALF + 0.8)],
    ]) {
      box(0.25, 4.5, 0.25, mat(0x333a42), x, 2.25, z);
      box(0.7, 1.8, 0.6, mat(0x1b2026), x, 4.3, z);
      const lamp = new T.Mesh(new T.SphereGeometry(0.3, 12, 8), new T.MeshBasicMaterial({ color: 0xff3b30 }));
      lamp.position.set(x, 4.3, z + Math.sign(z) * -0.35);
      sc.add(lamp);
      this.lights.push(lamp);
    }

    // The sensor mast and its coverage on the ground.
    this.mastPos = new T.Vector3(12, 9, -(ROAD_HALF + 2));
    box(0.35, 9, 0.35, mat(0x56606a), this.mastPos.x, 4.5, this.mastPos.z);
    this.mastHead = box(1.1, 0.7, 0.7, mat(token("--accent") || "#4fc3cf"), this.mastPos.x, 9, this.mastPos.z);
    const ring = new T.Mesh(
      new T.RingGeometry(this.sim.mast(this.station).range - 1.2, this.sim.mast(this.station).range, 96),
      new T.MeshBasicMaterial({ color: new T.Color(token("--accent") || "#4fc3cf"), transparent: true, opacity: 0.55, side: T.DoubleSide }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(this.mastPos.x, 0.08, this.mastPos.z);
    sc.add(ring);
    this.ring = ring;

    // Incident markers are rebuilt every frame from a small pool.
    this.incidentMat = mat(token("--crit") || "#f1575f");
    this.incidentPool = [];
    this.boxMat = new T.LineBasicMaterial({ color: new T.Color(token("--accent") || "#4fc3cf") });
    this.unitEdges = new T.EdgesGeometry(new T.BoxGeometry(1, 1, 1));
  }

  bindOrbit() {
    let drag = null;
    this.canvas.addEventListener("pointerdown", (e) => {
      if (this.mode !== "orbit") return;
      drag = { x: e.clientX, y: e.clientY, yaw: this.orbit.yaw, pitch: this.orbit.pitch };
      this.canvas.setPointerCapture(e.pointerId);
    });
    this.canvas.addEventListener("pointermove", (e) => {
      if (!drag) return;
      this.orbit.yaw = drag.yaw - (e.clientX - drag.x) * 0.006;
      this.orbit.pitch = Math.max(0.12, Math.min(1.45, drag.pitch + (e.clientY - drag.y) * 0.005));
    });
    const end = () => (drag = null);
    this.canvas.addEventListener("pointerup", end);
    this.canvas.addEventListener("pointercancel", end);
    this.canvas.addEventListener(
      "wheel",
      (e) => {
        if (this.mode !== "orbit") return;
        e.preventDefault();
        this.orbit.dist = Math.max(25, Math.min(320, this.orbit.dist * (1 + Math.sign(e.deltaY) * 0.1)));
      },
      { passive: false },
    );
  }

  setMode(mode) {
    this.mode = mode;
    this.follow = null;
  }

  vehicleMesh(v) {
    const T = this.T;
    const g = new T.Group();
    const color = v.type === "bus" ? 0xe0b030 : v.type === "truck" ? 0xc9cdd2 : CAR_COLORS[v.id % CAR_COLORS.length];
    const h = v.type === "car" ? 1.45 : v.type === "van" ? 2.2 : 3.1;
    const body = new T.Mesh(new T.BoxGeometry(v.len, h * 0.62, 1.85), new T.MeshLambertMaterial({ color }));
    body.position.set(-v.len / 2, h * 0.31 + 0.25, 0);
    g.add(body);
    const cabinLen = v.type === "car" ? v.len * 0.5 : v.type === "truck" ? 2.2 : v.len * 0.9;
    const cabin = new T.Mesh(new T.BoxGeometry(cabinLen, h * 0.38, 1.7), new T.MeshLambertMaterial({ color: v.type === "bus" ? 0xe0b030 : 0x223040 }));
    cabin.position.set(v.type === "truck" ? -1.2 : -v.len / 2, h * 0.62 + 0.25 + (h * 0.38) / 2, 0);
    g.add(cabin);
    const brakeMat = new T.MeshBasicMaterial({ color: 0x551111 });
    for (const z of [-0.65, 0.65]) {
      const b = new T.Mesh(new T.BoxGeometry(0.1, 0.25, 0.35), brakeMat);
      b.position.set(-v.len - 0.02, h * 0.45, z);
      g.add(b);
    }
    if (v.cv) {
      const antenna = new T.Mesh(new T.CylinderGeometry(0.06, 0.06, 0.6), new T.MeshBasicMaterial({ color: new T.Color(token("--accent") || "#4fc3cf") }));
      antenna.position.set(cabin.position.x, cabin.position.y + 0.5, 0);
      g.add(antenna);
    }
    g.userData = { brakeMat };
    this.scene.add(g);
    return g;
  }

  /** Draw one frame and return the HUD text (or null). */
  render() {
    const T = this.T;
    const sim = this.sim;
    const w = this.host.clientWidth;
    const h = this.host.clientHeight;
    if (this.canvas.width !== Math.round(w * this.renderer.getPixelRatio()) || this.size !== `${w}x${h}`) {
      this.size = `${w}x${h}`;
      this.renderer.setSize(w, h, false);
      this.canvas.style.width = "100%";
      this.canvas.style.height = "100%";
      this.camera.aspect = w / Math.max(1, h);
      this.camera.updateProjectionMatrix();
    }

    // Signal lamps.
    const sig = sim.signal(this.station);
    const lampColor = sig.state === "green" ? 0x30d158 : sig.state === "amber" ? 0xffb020 : 0xff3b30;
    for (const l of this.lights) l.material.color.setHex(lampColor);
    const healthy = sim.health[this.station] === "ok";
    this.ring.material.color.set(token(healthy ? "--accent" : "--crit"));
    this.mastHead.material.color.set(token(healthy ? "--accent" : "--crit"));

    // Vehicles: create, move, remove.
    const seen = new Set();
    for (const v of sim.vehicles()) {
      const x = sim.xOf(v) - this.st.x;
      if (Math.abs(x) > HALF_M + 10) continue;
      seen.add(v.id);
      let m = this.cars.get(v.id);
      if (!m) {
        m = this.vehicleMesh(v);
        this.cars.set(v.id, m);
      }
      m.position.set(x, 0, laneZ(v.d, v.lane));
      m.rotation.y = v.d === 0 ? 0 : Math.PI;
      m.userData.brakeMat.color.setHex(v.a < -0.6 || v.v < 0.5 ? 0xff2a2a : 0x551111);
      m.userData.v = v;
    }
    for (const [id, m] of this.cars) {
      if (!seen.has(id)) {
        this.scene.remove(m);
        m.traverse((o) => {
          o.geometry?.dispose();
          if (o.material && o.material !== m.userData.brakeMat) o.material.dispose?.();
        });
        this.cars.delete(id);
      }
    }

    // What the mast detects: wireframe boxes at the detected (noisy) positions, from a pool.
    const dets = sim.mast(this.station).detections.filter((det) => Math.abs(det.x - this.st.x) <= HALF_M);
    while (this.boxes.length < dets.length) {
      const b = new T.LineSegments(this.unitEdges, this.boxMat);
      this.scene.add(b);
      this.boxes.push(b);
    }
    this.boxes.forEach((b, k) => {
      const det = dets[k];
      b.visible = Boolean(det);
      if (!det) return;
      const x = det.x - this.st.x;
      b.scale.set(det.len + 0.6, 2.2, 2.3);
      b.position.set(det.d === 0 ? x - det.len / 2 : x + det.len / 2, 1.1, laneZ(det.d, det.lane));
    });

    // Incidents.
    this.incidentPool.forEach((m) => (m.visible = false));
    sim.incidents.forEach((inc, k) => {
      let m = this.incidentPool[k];
      if (!m) {
        m = new T.Mesh(new T.ConeGeometry(0.5, 1, 12), this.incidentMat);
        this.scene.add(m);
        this.incidentPool[k] = m;
      }
      m.visible = Math.abs(inc.x - this.st.x) < HALF_M;
      m.position.set(inc.x - this.st.x + (inc.d === 0 ? -6 : 6), 0.5, laneZ(inc.d, inc.lane));
    });

    // Camera.
    let hud = null;
    if (this.mode === "orbit") {
      const { yaw, pitch, dist } = this.orbit;
      this.camera.position.set(Math.sin(yaw) * Math.cos(pitch) * dist, Math.sin(pitch) * dist, Math.cos(yaw) * Math.cos(pitch) * dist);
      this.camera.lookAt(0, 0, 0);
    } else if (this.mode === "mast") {
      this.camera.position.copy(this.mastPos).add(new T.Vector3(-1.2, 1.4, 0.8)); // just beside the sensor head
      this.camera.lookAt(-35, 0, 6);
      hud = `Sensor mast view · ${sim.mast(this.station).detections.length} objects detected · ${healthy ? "healthy" : "degraded"}`;
    } else {
      hud = this.driverCamera(sig);
    }
    this.renderer.render(this.scene, this.camera);
    return hud;
  }

  /** Follow a connected vehicle approaching the junction in direction 0. */
  driverCamera(sig) {
    const sim = this.sim;
    const stopX = this.st.x - 8;
    const ok = (v) => v && v.d === 0 && sim.xOf(v) < stopX + 30 && sim.xOf(v) > this.st.x - HALF_M && sim.vehicles().includes(v);
    if (!ok(this.follow)) {
      const candidates = sim.vehicles().filter((v) => v.d === 0 && v.cv && sim.xOf(v) < stopX - 60 && sim.xOf(v) > this.st.x - HALF_M + 10);
      candidates.sort((a, b) => sim.xOf(b) - sim.xOf(a));
      this.follow = candidates[candidates.length - 1] ?? sim.vehicles().find((v) => v.d === 0 && sim.xOf(v) < stopX && sim.xOf(v) > this.st.x - HALF_M) ?? null;
    }
    const v = this.follow;
    if (!v) {
      this.camera.position.set(-HALF_M + 20, 3, laneZ(0, 0));
      this.camera.lookAt(0, 1.5, laneZ(0, 0));
      return "Waiting for a vehicle to follow…";
    }
    const x = sim.xOf(v) - this.st.x;
    const z = laneZ(v.d, v.lane);
    this.camera.position.set(x - v.len - 7, 3.2, z);
    this.camera.lookAt(x + 30, 1.2, z * 0.6);
    const dist = Math.max(0, stopX - sim.xOf(v));
    if (sim.xOf(v) > stopX) return `Vehicle #${v.id} · ${Math.round(v.v * 3.6)} km/h · through the junction`;
    const advice = sim.greenSpeed(this.station, dist);
    const change = `${sig.state} for ${Math.round(sig.toChange)} s`;
    const tip = advice?.kmh ? `advice ${advice.kmh} km/h to arrive on green` : "prepare to stop";
    return `${v.cv ? "Connected" : "Unconnected"} vehicle #${v.id} · ${Math.round(v.v * 3.6)} km/h · ${Math.round(dist)} m to the light · ${change} · ${v.cv ? tip : "no V2X advice"}`;
  }

  dispose() {
    this.renderer.dispose();
    this.scene.traverse((o) => {
      o.geometry?.dispose();
      o.material?.dispose?.();
    });
    this.canvas.remove();
  }
}
