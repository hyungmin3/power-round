import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { CHALLENGES, GAME_CONFIG } from "./config";
import { DEFAULT_PROFILE, loadProfile, saveProfile } from "./storage";
import type {
  ChallengeProgress,
  EnemyArchetype,
  HazardType,
  PersistedProfile,
  PlayerState,
  RunState,
} from "./types";

type OverlayMode = "menu" | "playing" | "death" | "result";

interface HealthBar {
  group: THREE.Group;
  background: THREE.Mesh;
  fill: THREE.Mesh;
  width: number;
}

interface Obstacle {
  position: THREE.Vector3;
  radius: number;
  mesh: THREE.Object3D;
}

interface EnemyRig {
  jaw?: THREE.Object3D;
  eye?: THREE.Object3D;
  halo?: THREE.Object3D;
  limbs?: THREE.Object3D[];
  extra?: THREE.Object3D[];
}

interface HazardZone {
  type: HazardType;
  label: string;
  position: THREE.Vector3;
  radius: number;
  surface: THREE.Mesh;
  ring: THREE.Mesh;
  accent: THREE.Group;
  light: THREE.PointLight;
  particles: THREE.Mesh[];
  phase: number;
}

interface EnemyBundle {
  group: THREE.Group;
  visual: THREE.Group;
  rig: EnemyRig;
  healthBar: HealthBar;
}

interface EnemyInstance {
  type: EnemyArchetype;
  title: string;
  mesh: THREE.Group;
  visual: THREE.Group;
  rig: EnemyRig;
  healthBar: HealthBar;
  velocity: THREE.Vector3;
  health: number;
  maxHealth: number;
  speed: number;
  attackCooldown: number;
  lifetime: number;
  phase: number;
  orbitDirection: number;
  radius: number;
  hurtTime: number;
}

interface ProjectileInstance {
  mesh: THREE.Mesh;
  velocity: THREE.Vector3;
  life: number;
  damage: number;
}

interface EffectInstance {
  mesh: THREE.Object3D;
  life: number;
  maxLife: number;
  drift?: THREE.Vector3;
  scaleGrowth: number;
}

interface RelicState {
  mesh: THREE.Group;
  collected: boolean;
  bobTime: number;
}

interface PlayerBundle {
  group: THREE.Group;
  visual: THREE.Group;
  weapon: THREE.Mesh;
  attackArc: THREE.Mesh;
  healthBar: HealthBar;
}

interface RuntimePlayer {
  mesh: THREE.Group;
  visual: THREE.Group;
  weapon: THREE.Mesh;
  attackArc: THREE.Mesh;
  healthBar: HealthBar;
  state: PlayerState;
  facingAngle: number;
  attackCooldown: number;
  attackSwingTime: number;
  dashCooldown: number;
  dashTime: number;
  dashDirection: THREE.Vector3;
  invulnerability: number;
  damageBuff: number;
  speedBuff: number;
  hurtTime: number;
  radius: number;
}

interface RuntimeRun {
  state: RunState;
  player: RuntimePlayer;
  elapsedSpawn: number;
  bossSpawned: boolean;
  relic: RelicState;
}

interface OverlayRefs {
  menu: HTMLElement;
  death: HTMLElement;
  result: HTMLElement;
  statusLine: HTMLElement;
}

interface HudRefs {
  cash: HTMLElement;
  time: HTMLElement;
  health: HTMLElement;
  kills: HTMLElement;
  boss: HTMLElement;
  challengeList: HTMLElement;
}

interface ButtonRefs {
  start: HTMLButtonElement;
  restart: HTMLButtonElement;
  retry: HTMLButtonElement;
  abandon: HTMLButtonElement;
  attack: HTMLButtonElement;
  dash: HTMLButtonElement;
}

interface ProfileRefs {
  cash: HTMLElement;
  best: HTMLElement;
  runs: HTMLElement;
  bosses: HTMLElement;
}

interface ResultRefs {
  title: HTMLElement;
  summary: HTMLElement;
}

interface DeathRefs {
  title: HTMLElement;
  summary: HTMLElement;
}

function createChallengeState(): ChallengeProgress[] {
  return CHALLENGES.map((challenge) => ({
    ...challenge,
    completed: false,
    progressText: "Active",
  }));
}

function clampVectorLength(vector: THREE.Vector2, maxLength: number): THREE.Vector2 {
  if (vector.lengthSq() <= maxLength * maxLength) {
    return vector;
  }
  return vector.normalize().multiplyScalar(maxLength);
}

function formatTime(time: number): string {
  const whole = Math.floor(time);
  const minutes = Math.floor(whole / 60);
  const seconds = whole % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function angleToForward(angle: number): THREE.Vector3 {
  return new THREE.Vector3(Math.sin(angle), 0, Math.cos(angle));
}

function createGroundTexture(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 512;
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Unable to create ground texture context.");
  }

  const gradient = context.createRadialGradient(256, 256, 32, 256, 256, 256);
  gradient.addColorStop(0, "#475963");
  gradient.addColorStop(0.56, "#223441");
  gradient.addColorStop(1, "#101923");
  context.fillStyle = gradient;
  context.fillRect(0, 0, 512, 512);

  for (let index = 0; index < 1600; index += 1) {
    const x = Math.random() * 512;
    const y = Math.random() * 512;
    const alpha = 0.03 + Math.random() * 0.08;
    const size = 1 + Math.random() * 3;
    context.fillStyle = `rgba(212, 195, 158, ${alpha.toFixed(3)})`;
    context.fillRect(x, y, size, size);
  }

  for (let ring = 0; ring < 10; ring += 1) {
    context.strokeStyle = `rgba(170, 220, 255, ${0.015 + ring * 0.004})`;
    context.lineWidth = 2 + ring;
    context.beginPath();
    context.arc(256, 256, 64 + ring * 30, 0, Math.PI * 2);
    context.stroke();
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(6, 6);
  texture.anisotropy = 8;
  return texture;
}

function createSkyMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    side: THREE.BackSide,
    uniforms: {
      topColor: { value: new THREE.Color(0x4d6d90) },
      midColor: { value: new THREE.Color(0x111b2a) },
      bottomColor: { value: new THREE.Color(0x05090d) },
    },
    vertexShader: `
      varying vec3 vWorldPosition;
      void main() {
        vec4 worldPosition = modelMatrix * vec4(position, 1.0);
        vWorldPosition = worldPosition.xyz;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform vec3 topColor;
      uniform vec3 midColor;
      uniform vec3 bottomColor;
      varying vec3 vWorldPosition;
      void main() {
        float h = normalize(vWorldPosition + vec3(0.0, 60.0, 0.0)).y;
        vec3 color = mix(bottomColor, midColor, smoothstep(-0.2, 0.35, h));
        color = mix(color, topColor, smoothstep(0.18, 0.95, h));
        gl_FragColor = vec4(color, 1.0);
      }
    `,
  });
}

function createHealthBar(width: number): HealthBar {
  const fillWidth = width - 0.08;
  const group = new THREE.Group();
  const frame = new THREE.Mesh(
    new THREE.PlaneGeometry(width + 0.14, 0.28),
    new THREE.MeshBasicMaterial({ color: 0xd7f2ff, transparent: true, opacity: 0.94 }),
  );
  const background = new THREE.Mesh(
    new THREE.PlaneGeometry(width, 0.18),
    new THREE.MeshBasicMaterial({ color: 0x07131d, transparent: true, opacity: 0.96 }),
  );
  const fill = new THREE.Mesh(
    new THREE.PlaneGeometry(fillWidth, 0.12),
    new THREE.MeshBasicMaterial({ color: 0x7fff9b, transparent: true, opacity: 0.98 }),
  );
  frame.position.z = -0.03;
  background.position.z = -0.02;
  fill.position.z = 0.02;
  group.add(frame);
  group.add(background);
  group.add(fill);
  return { group, background, fill, width: fillWidth };
}

function updateHealthBar(bar: HealthBar, ratio: number, camera: THREE.Camera): void {
  const clamped = THREE.MathUtils.clamp(ratio, 0, 1);
  bar.group.quaternion.copy(camera.quaternion);
  bar.fill.scale.x = Math.max(0.001, clamped);
  bar.fill.position.x = -bar.width * (1 - clamped) * 0.5;
  const material = bar.fill.material as THREE.MeshBasicMaterial;
  material.color.setHSL(0.02 + clamped * 0.28, 0.88, 0.52);
}

function createEnemyMesh(type: EnemyArchetype): EnemyBundle {
  const group = new THREE.Group();
  const visual = new THREE.Group();
  const rig: EnemyRig = { limbs: [], extra: [] };
  const healthBar = createHealthBar(type === "boss" ? 5.4 : 2.85);
  healthBar.group.position.y = type === "boss" ? 8.9 : 4.15;
  group.add(visual);
  group.add(healthBar.group);

  if (type === "melee") {
    const body = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.72, 1.7, 4, 10),
      new THREE.MeshStandardMaterial({ color: 0x353842, roughness: 0.72, metalness: 0.08 }),
    );
    body.rotation.z = Math.PI * 0.5;
    body.position.set(0, 1.15, -0.2);
    body.castShadow = true;
    visual.add(body);

    const head = new THREE.Mesh(
      new THREE.SphereGeometry(0.92, 18, 18),
      new THREE.MeshStandardMaterial({ color: 0x2b3038, roughness: 0.55, metalness: 0.1 }),
    );
    head.position.set(0, 1.3, 1.2);
    head.castShadow = true;
    visual.add(head);

    const jaw = new THREE.Mesh(
      new THREE.BoxGeometry(1.05, 0.34, 1.15),
      new THREE.MeshStandardMaterial({ color: 0x150f10, roughness: 0.5 }),
    );
    jaw.position.set(0, 0.78, 1.45);
    jaw.castShadow = true;
    visual.add(jaw);
    rig.jaw = jaw;

    for (let side = -1; side <= 1; side += 2) {
      for (const z of [-0.7, 0.55]) {
        const leg = new THREE.Mesh(
          new THREE.CylinderGeometry(0.12, 0.14, 1.2, 6),
          new THREE.MeshStandardMaterial({ color: 0x1a2329, roughness: 0.84 }),
        );
        leg.position.set(side * 0.55, 0.56, z);
        leg.rotation.z = side * 0.18;
        leg.castShadow = true;
        visual.add(leg);
        rig.limbs?.push(leg);
      }
    }

    for (let index = 0; index < 4; index += 1) {
      const spike = new THREE.Mesh(
        new THREE.ConeGeometry(0.16, 0.7, 5),
        new THREE.MeshStandardMaterial({
          color: 0xb8e8ff,
          emissive: 0x5bcfff,
          emissiveIntensity: 0.45,
          roughness: 0.28,
        }),
      );
      spike.position.set((index - 1.5) * 0.28, 1.95, -0.45 - index * 0.28);
      spike.rotation.x = -Math.PI * 0.45;
      visual.add(spike);
      rig.extra?.push(spike);
    }

    return { group, visual, rig, healthBar };
  }

  if (type === "spitter") {
    const eye = new THREE.Mesh(
      new THREE.SphereGeometry(1.02, 20, 20),
      new THREE.MeshStandardMaterial({ color: 0xe7e6de, roughness: 0.35, metalness: 0.02 }),
    );
    eye.position.set(0, 2.1, 0);
    eye.castShadow = true;
    visual.add(eye);
    rig.eye = eye;

    const iris = new THREE.Mesh(
      new THREE.SphereGeometry(0.42, 16, 16),
      new THREE.MeshStandardMaterial({
        color: 0x1b2431,
        emissive: 0x6ee5ff,
        emissiveIntensity: 0.7,
        roughness: 0.18,
      }),
    );
    iris.position.set(0, 2.08, 0.82);
    visual.add(iris);
    rig.extra?.push(iris);

    const halo = new THREE.Mesh(
      new THREE.TorusGeometry(1.6, 0.09, 8, 24),
      new THREE.MeshStandardMaterial({
        color: 0xffe19e,
        emissive: 0xffc96c,
        emissiveIntensity: 0.9,
        roughness: 0.2,
      }),
    );
    halo.position.set(0, 2.08, 0);
    halo.rotation.x = Math.PI * 0.5;
    visual.add(halo);
    rig.halo = halo;

    for (let index = 0; index < 8; index += 1) {
      const angle = (index / 8) * Math.PI * 2;
      const tendril = new THREE.Mesh(
        new THREE.ConeGeometry(0.14, 1.25, 5),
        new THREE.MeshStandardMaterial({ color: 0x2b2f3a, roughness: 0.72 }),
      );
      tendril.position.set(Math.cos(angle) * 1.22, 1.75, Math.sin(angle) * 1.22);
      tendril.lookAt(0, 0.9, 0);
      visual.add(tendril);
      rig.limbs?.push(tendril);
    }

    return { group, visual, rig, healthBar };
  }

  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(2.7, 0.72, 20, 32),
    new THREE.MeshStandardMaterial({
      color: 0x2a2226,
      emissive: 0xa31528,
      emissiveIntensity: 0.65,
      roughness: 0.38,
      metalness: 0.16,
    }),
  );
  ring.position.set(0, 4.2, 0);
  ring.castShadow = true;
  visual.add(ring);
  rig.halo = ring;

  const eye = new THREE.Mesh(
    new THREE.SphereGeometry(0.88, 18, 18),
    new THREE.MeshStandardMaterial({
      color: 0xf1ddda,
      emissive: 0xff7886,
      emissiveIntensity: 0.9,
      roughness: 0.2,
    }),
  );
  eye.position.set(0, 4.5, 0.8);
  visual.add(eye);
  rig.eye = eye;

  for (let index = 0; index < 14; index += 1) {
    const angle = (index / 14) * Math.PI * 2;
    const tooth = new THREE.Mesh(
      new THREE.ConeGeometry(0.18, 0.85, 5),
      new THREE.MeshStandardMaterial({ color: 0xf6d8bc, roughness: 0.28 }),
    );
    tooth.position.set(Math.cos(angle) * 1.95, 4.2 + Math.sin(angle) * 0.18, Math.sin(angle) * 1.95);
    tooth.lookAt(0, 4.2, 0);
    visual.add(tooth);
    rig.extra?.push(tooth);
  }

  for (let index = 0; index < 5; index += 1) {
    const orb = new THREE.Mesh(
      new THREE.SphereGeometry(0.35, 14, 14),
      new THREE.MeshStandardMaterial({
        color: 0xfff0c8,
        emissive: 0xff9b74,
        emissiveIntensity: 0.9,
        roughness: 0.18,
      }),
    );
    orb.position.set(Math.cos(index * 1.2) * 4.6, 5.1 + (index % 2) * 0.5, Math.sin(index * 1.2) * 4.6);
    visual.add(orb);
    rig.extra?.push(orb);
  }

  return { group, visual, rig, healthBar };
}

function createPlayerMesh(): PlayerBundle {
  const group = new THREE.Group();
  const visual = new THREE.Group();
  group.add(visual);

  const legs = new THREE.Mesh(
    new THREE.BoxGeometry(1.15, 1.35, 0.78),
    new THREE.MeshStandardMaterial({ color: 0x2f3a46, roughness: 0.62, metalness: 0.18 }),
  );
  legs.position.set(0, 0.78, 0.02);
  legs.castShadow = true;
  visual.add(legs);

  const torso = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.82, 2.15, 6, 14),
    new THREE.MeshStandardMaterial({ color: 0x8a97a9, roughness: 0.24, metalness: 0.36 }),
  );
  torso.castShadow = true;
  torso.position.y = 2.12;
  visual.add(torso);

  const chestPlate = new THREE.Mesh(
    new THREE.BoxGeometry(1.48, 1.6, 0.58),
    new THREE.MeshStandardMaterial({ color: 0x24303d, roughness: 0.68, metalness: 0.1 }),
  );
  chestPlate.position.set(0, 2.08, 0.38);
  chestPlate.castShadow = true;
  visual.add(chestPlate);

  const chestCore = new THREE.Mesh(
    new THREE.OctahedronGeometry(0.32, 0),
    new THREE.MeshStandardMaterial({
      color: 0xf3fbff,
      emissive: 0x77e8ff,
      emissiveIntensity: 1.45,
      roughness: 0.1,
      metalness: 0.24,
    }),
  );
  chestCore.position.set(0, 2.12, 0.72);
  visual.add(chestCore);

  const shoulderLeft = new THREE.Mesh(
    new THREE.SphereGeometry(0.38, 12, 12),
    new THREE.MeshStandardMaterial({ color: 0x4f5f70, roughness: 0.58, metalness: 0.16 }),
  );
  shoulderLeft.position.set(-0.98, 2.62, 0.12);
  shoulderLeft.castShadow = true;
  visual.add(shoulderLeft);

  const shoulderRight = shoulderLeft.clone();
  shoulderRight.position.x *= -1;
  visual.add(shoulderRight);

  const cape = new THREE.Mesh(
    new THREE.BoxGeometry(1.1, 2.7, 0.08),
    new THREE.MeshStandardMaterial({ color: 0x161f2a, roughness: 0.88, metalness: 0.02 }),
  );
  cape.position.set(0, 1.86, -0.62);
  cape.rotation.x = 0.08;
  cape.castShadow = true;
  visual.add(cape);

  const helmet = new THREE.Mesh(
    new THREE.SphereGeometry(0.66, 16, 16),
    new THREE.MeshStandardMaterial({ color: 0xdde3ea, roughness: 0.24, metalness: 0.26 }),
  );
  helmet.position.set(0, 3.2, 0.08);
  helmet.castShadow = true;
  visual.add(helmet);

  const visor = new THREE.Mesh(
    new THREE.BoxGeometry(0.88, 0.28, 0.14),
    new THREE.MeshStandardMaterial({
      color: 0xfaf8e1,
      emissive: 0x96f0ff,
      emissiveIntensity: 1.25,
      roughness: 0.08,
    }),
  );
  visor.position.set(0, 3.16, 0.62);
  visual.add(visor);

  const crest = new THREE.Mesh(
    new THREE.ConeGeometry(0.22, 0.96, 5),
    new THREE.MeshStandardMaterial({
      color: 0xc3f5ff,
      emissive: 0x63e8ff,
      emissiveIntensity: 0.82,
      roughness: 0.18,
    }),
  );
  crest.position.set(0, 4.02, 0.02);
  crest.castShadow = true;
  visual.add(crest);

  const bootLeft = new THREE.Mesh(
    new THREE.BoxGeometry(0.42, 0.32, 0.72),
    new THREE.MeshStandardMaterial({ color: 0x11161d, roughness: 0.92 }),
  );
  bootLeft.position.set(-0.34, 0.1, 0.1);
  bootLeft.castShadow = true;
  visual.add(bootLeft);

  const bootRight = bootLeft.clone();
  bootRight.position.x *= -1;
  visual.add(bootRight);

  const weapon = new THREE.Mesh(
    new THREE.BoxGeometry(0.18, 2.45, 0.18),
    new THREE.MeshStandardMaterial({
      color: 0xd2f7ff,
      emissive: 0x83ecff,
      emissiveIntensity: 1.18,
      roughness: 0.08,
      metalness: 0.52,
    }),
  );
  weapon.position.set(1.15, 1.62, 0.15);
  weapon.rotation.z = -0.55;
  weapon.castShadow = true;
  visual.add(weapon);

  const crossGuard = new THREE.Mesh(
    new THREE.BoxGeometry(0.72, 0.12, 0.18),
    new THREE.MeshStandardMaterial({ color: 0x6c8294, roughness: 0.34, metalness: 0.48 }),
  );
  crossGuard.position.set(1.07, 2.72, 0.15);
  crossGuard.castShadow = true;
  visual.add(crossGuard);

  const attackArc = new THREE.Mesh(
    new THREE.RingGeometry(1.35, 6.45, 48, 1, -1.1, 2.2),
    new THREE.MeshBasicMaterial({
      color: 0x91efff,
      transparent: true,
      opacity: 0,
      side: THREE.DoubleSide,
      depthWrite: false,
    }),
  );
  attackArc.rotation.set(-Math.PI * 0.5, -Math.PI * 0.5, 0);
  attackArc.position.y = 0.08;
  attackArc.visible = false;
  group.add(attackArc);

  const healthBar = createHealthBar(3.2);
  healthBar.group.position.y = 5.4;
  group.add(healthBar.group);

  return { group, visual, weapon, attackArc, healthBar };
}

export class PowerRoundApp {
  private readonly root: HTMLElement;
  private readonly stage: HTMLElement;
  private readonly overlays: OverlayRefs;
  private readonly hud: HudRefs;
  private readonly buttons: ButtonRefs;
  private readonly profileRefs: ProfileRefs;
  private readonly resultRefs: ResultRefs;
  private readonly deathRefs: DeathRefs;
  private readonly joystick: HTMLElement;
  private readonly joystickThumb: HTMLElement;
  private readonly mobileControls: HTMLElement;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly composer: EffectComposer;
  private readonly bloomPass: UnrealBloomPass;
  private readonly scene: THREE.Scene;
  private readonly camera: THREE.PerspectiveCamera;
  private readonly clock = new THREE.Clock();
  private readonly keyboardState = new Map<string, boolean>();
  private readonly mobileMove = new THREE.Vector2();
  private readonly effects: EffectInstance[] = [];
  private readonly hazards: HazardZone[] = [];
  private readonly enemies: EnemyInstance[] = [];
  private readonly projectiles: ProjectileInstance[] = [];
  private readonly obstacles: Obstacle[] = [];
  private readonly dynamicGroup = new THREE.Group();
  private readonly cameraFocus = new THREE.Vector3();
  private readonly playerSpawn = new THREE.Vector3(0, 0, -48);
  private readonly relicPosition = new THREE.Vector3(-44, 0, 44);
  private readonly altarPosition = new THREE.Vector3(0, 0, 58);
  private readonly boundaryRadius = GAME_CONFIG.arenaRadius - 4;

  private profile: PersistedProfile = loadProfile();
  private overlayMode: OverlayMode = "menu";
  private run: RuntimeRun | null = null;
  private attackRequested = false;
  private dashRequested = false;
  private joystickPointerId: number | null = null;
  private coarsePointer =
    window.matchMedia("(pointer: coarse)").matches || navigator.maxTouchPoints > 0;

  constructor(root: HTMLElement) {
    this.root = root;
    this.root.innerHTML = `
      <div class="app-shell">
        <div id="stage" class="stage"></div>
        <section class="hud">
          <div class="hud-top">
            <div class="hud-card"><span class="hud-label">Cash</span><strong id="hud-cash">$0</strong></div>
            <div class="hud-card"><span class="hud-label">Survival</span><strong id="hud-time">0:00</strong></div>
            <div class="hud-card"><span class="hud-label">Health</span><strong id="hud-health">0 / 0</strong></div>
            <div class="hud-card"><span class="hud-label">Kills</span><strong id="hud-kills">0</strong></div>
            <div class="hud-card boss-card"><span class="hud-label">Boss</span><strong id="hud-boss">Dormant</strong></div>
          </div>
          <div class="hud-side">
            <div class="challenge-panel compact-panel">
              <div class="panel-header"><h2>Challenges</h2><span>Compact feed</span></div>
              <div id="challenge-list" class="challenge-list compact-list"></div>
            </div>
            <div class="status-panel compact-panel feed-panel">
              <div class="panel-header"><h2>Arena Feed</h2><span>Live</span></div>
              <p id="status-line">Tank controls online. Move north, keep the boundary wall in sight, and watch your forward attack arc.</p>
            </div>
          </div>
        </section>
        <section class="overlay menu-overlay" data-overlay="menu">
          <div class="panel intro-panel">
            <p class="eyebrow">Power Round</p>
            <h1>Wide arena survival with chase camera combat.</h1>
            <p class="lead">The camera stays behind your character. W or Up drives forward, S reverses, A and D turn. Your attack is directional, not 360 degrees, and the front arc now appears on the ground when you swing.</p>
            <div class="profile-grid">
              <div><span>Cash</span><strong id="profile-cash">$0</strong></div>
              <div><span>Best Survival</span><strong id="profile-best">0:00</strong></div>
              <div><span>Total Runs</span><strong id="profile-runs">0</strong></div>
              <div><span>Boss Defeats</span><strong id="profile-bosses">0</strong></div>
            </div>
            <div class="control-notes">
              <p><strong>Desktop</strong> W or Up forward, S or Down reverse, A or Left turn left, D or Right turn right, Space or left click for a directional heavy strike, Shift to dash.</p>
              <p><strong>Mobile</strong> The left stick handles forward, reverse, and turning. The right buttons strike and dash. Rocks and the outer wall now block movement.</p>
            </div>
            <button id="start-run" class="primary-button">Drive Into the Arena</button>
          </div>
        </section>
        <section class="overlay result-overlay hidden" data-overlay="result">
          <div class="panel">
            <p class="eyebrow">Run Summary</p>
            <h2 id="result-title">Run Complete</h2>
            <p id="result-summary" class="lead"></p>
            <button id="restart-run" class="primary-button">Start New Run</button>
          </div>
        </section>
        <section class="overlay death-overlay hidden" data-overlay="death">
          <div class="panel">
            <p class="eyebrow">Revival Window</p>
            <h2 id="death-title">You fell.</h2>
            <p id="death-summary" class="lead"></p>
            <div class="button-row">
              <button id="retry-run" class="primary-button">Pay $100 and Revive</button>
              <button id="abandon-run" class="secondary-button">End This Run</button>
            </div>
          </div>
        </section>
        <div class="mobile-controls ${this.coarsePointer ? "" : "hidden"}">
          <div id="joystick" class="joystick"><div id="joystick-thumb" class="joystick-thumb"></div></div>
          <div class="action-cluster">
            <button id="attack-button" class="action-button">Strike</button>
            <button id="dash-button" class="action-button secondary-action">Dash</button>
          </div>
        </div>
      </div>
    `;

    this.stage = this.getElement<HTMLElement>("#stage");
    this.joystick = this.getElement<HTMLElement>("#joystick");
    this.mobileControls = this.getElement<HTMLElement>(".mobile-controls");
    this.joystickThumb = this.getElement<HTMLElement>("#joystick-thumb");
    this.overlays = {
      menu: this.getElement<HTMLElement>('[data-overlay="menu"]'),
      death: this.getElement<HTMLElement>('[data-overlay="death"]'),
      result: this.getElement<HTMLElement>('[data-overlay="result"]'),
      statusLine: this.getElement<HTMLElement>("#status-line"),
    };
    this.hud = {
      cash: this.getElement<HTMLElement>("#hud-cash"),
      time: this.getElement<HTMLElement>("#hud-time"),
      health: this.getElement<HTMLElement>("#hud-health"),
      kills: this.getElement<HTMLElement>("#hud-kills"),
      boss: this.getElement<HTMLElement>("#hud-boss"),
      challengeList: this.getElement<HTMLElement>("#challenge-list"),
    };
    this.buttons = {
      start: this.getElement<HTMLButtonElement>("#start-run"),
      restart: this.getElement<HTMLButtonElement>("#restart-run"),
      retry: this.getElement<HTMLButtonElement>("#retry-run"),
      abandon: this.getElement<HTMLButtonElement>("#abandon-run"),
      attack: this.getElement<HTMLButtonElement>("#attack-button"),
      dash: this.getElement<HTMLButtonElement>("#dash-button"),
    };
    this.profileRefs = {
      cash: this.getElement<HTMLElement>("#profile-cash"),
      best: this.getElement<HTMLElement>("#profile-best"),
      runs: this.getElement<HTMLElement>("#profile-runs"),
      bosses: this.getElement<HTMLElement>("#profile-bosses"),
    };
    this.resultRefs = {
      title: this.getElement<HTMLElement>("#result-title"),
      summary: this.getElement<HTMLElement>("#result-summary"),
    };
    this.deathRefs = {
      title: this.getElement<HTMLElement>("#death-title"),
      summary: this.getElement<HTMLElement>("#death-summary"),
    };

    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.16;
    this.stage.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x08111a);
    this.scene.fog = new THREE.FogExp2(0x070d14, 0.0062);

    this.camera = new THREE.PerspectiveCamera(64, 1, 0.1, 250);
    this.camera.position.set(0, 7, -18);

    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloomPass = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.58, 0.8, 0.16);
    this.composer.addPass(this.bloomPass);

    this.scene.add(this.dynamicGroup);
    this.setupScene();
    this.bindEvents();
    this.syncProfileUi();
    this.showOverlay("menu");
    this.renderChallengeList(createChallengeState());
    this.resize();
    this.animate();
  }

  private getElement<T extends Element>(selector: string): T {
    const element = this.root.querySelector(selector);
    if (!element) {
      throw new Error(`Missing element: ${selector}`);
    }
    return element as T;
  }

  private setupScene(): void {
    const sky = new THREE.Mesh(new THREE.SphereGeometry(220, 40, 24), createSkyMaterial());
    this.scene.add(sky);

    const hemi = new THREE.HemisphereLight(0x88b6d8, 0x101822, 1.45);
    this.scene.add(hemi);

    const moon = new THREE.DirectionalLight(0xffe7bf, 2.1);
    moon.position.set(38, 42, -10);
    moon.castShadow = true;
    moon.shadow.camera.left = -80;
    moon.shadow.camera.right = 80;
    moon.shadow.camera.top = 80;
    moon.shadow.camera.bottom = -80;
    moon.shadow.mapSize.set(2048, 2048);
    this.scene.add(moon);

    const rim = new THREE.DirectionalLight(0x5ad0ff, 0.9);
    rim.position.set(-24, 14, 28);
    this.scene.add(rim);

    const terrain = new THREE.Mesh(
      new THREE.CircleGeometry(GAME_CONFIG.arenaRadius + 12, 120),
      new THREE.MeshStandardMaterial({
        map: createGroundTexture(),
        color: 0x9ea9a1,
        roughness: 0.95,
        metalness: 0.02,
      }),
    );
    terrain.rotation.x = -Math.PI * 0.5;
    terrain.position.y = -0.02;
    terrain.receiveShadow = true;
    this.scene.add(terrain);

    const underplate = new THREE.Mesh(
      new THREE.CylinderGeometry(GAME_CONFIG.arenaRadius + 18, GAME_CONFIG.arenaRadius + 24, 6, 64),
      new THREE.MeshStandardMaterial({ color: 0x1a232e, roughness: 0.92, metalness: 0.04 }),
    );
    underplate.position.y = -3.1;
    underplate.receiveShadow = true;
    this.scene.add(underplate);

    const lane = new THREE.Mesh(
      new THREE.TorusGeometry(this.boundaryRadius - 12, 0.9, 10, 96),
      new THREE.MeshStandardMaterial({
        color: 0x57646f,
        emissive: 0x1d2a38,
        emissiveIntensity: 0.22,
        roughness: 0.56,
      }),
    );
    lane.rotation.x = Math.PI * 0.5;
    lane.position.y = 0.1;
    this.scene.add(lane);

    const boundaryRing = new THREE.Mesh(
      new THREE.TorusGeometry(this.boundaryRadius, 0.65, 12, 96),
      new THREE.MeshStandardMaterial({
        color: 0x9fd8ff,
        emissive: 0x4ec8ff,
        emissiveIntensity: 0.78,
        roughness: 0.2,
      }),
    );
    boundaryRing.rotation.x = Math.PI * 0.5;
    boundaryRing.position.y = 0.22;
    this.scene.add(boundaryRing);

    const boundaryWall = new THREE.Mesh(
      new THREE.CylinderGeometry(this.boundaryRadius, this.boundaryRadius, 8, 96, 1, true),
      new THREE.MeshStandardMaterial({
        color: 0x9fd8ff,
        emissive: 0x3fa4d8,
        emissiveIntensity: 0.32,
        transparent: true,
        opacity: 0.18,
        side: THREE.DoubleSide,
        roughness: 0.18,
      }),
    );
    boundaryWall.position.y = 4;
    this.scene.add(boundaryWall);

    this.createHazard("poison", "Poison bog", new THREE.Vector3(34, 0, -14), 9.5, 0x75ff7e);
    this.createHazard("fire", "Lava trench", new THREE.Vector3(-34, 0, 22), 8.5, 0xff7d37);
    this.createHazard("water", "Drowning basin", new THREE.Vector3(24, 0, 40), 10.5, 0x5fb8ff);

    const altar = new THREE.Mesh(
      new THREE.CylinderGeometry(5.8, 7.8, 2.4, 10),
      new THREE.MeshStandardMaterial({
        color: 0x2c1b21,
        emissive: 0x43131f,
        emissiveIntensity: 0.7,
        roughness: 0.75,
      }),
    );
    altar.position.copy(this.altarPosition);
    altar.position.y = 1.2;
    altar.castShadow = true;
    altar.receiveShadow = true;
    this.scene.add(altar);

    const altarLight = new THREE.PointLight(0xff5f68, 4.2, 42, 2);
    altarLight.position.copy(this.altarPosition).add(new THREE.Vector3(0, 5.8, 0));
    this.scene.add(altarLight);

    const relicPedestal = new THREE.Mesh(
      new THREE.CylinderGeometry(2.1, 3.2, 3.4, 8),
      new THREE.MeshStandardMaterial({ color: 0x455565, roughness: 0.86, metalness: 0.08 }),
    );
    relicPedestal.position.copy(this.relicPosition);
    relicPedestal.position.y = 1.7;
    relicPedestal.castShadow = true;
    relicPedestal.receiveShadow = true;
    this.scene.add(relicPedestal);

    for (let index = 0; index < 62; index += 1) {
      const angle = Math.random() * Math.PI * 2;
      const radius = 12 + Math.random() * (this.boundaryRadius - 10);
      const position = new THREE.Vector3(Math.cos(angle) * radius, 0, Math.sin(angle) * radius);
      const size = 1 + Math.random() * 2.6;
      const rock = new THREE.Mesh(
        new THREE.DodecahedronGeometry(size, 0),
        new THREE.MeshStandardMaterial({ color: 0x4a5761, roughness: 0.92, metalness: 0.04 }),
      );
      rock.position.copy(position);
      rock.position.y = 0.8 + Math.random() * 1.5;
      rock.scale.set(1 + Math.random() * 1.3, 0.8 + Math.random() * 1.7, 0.9 + Math.random() * 1.4);
      rock.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);
      rock.castShadow = true;
      rock.receiveShadow = true;
      this.scene.add(rock);
      this.obstacles.push({ position: position.clone(), radius: size * (0.62 + Math.max(rock.scale.x, rock.scale.z) * 0.34), mesh: rock });
    }
  }

  private createHazard(type: HazardType, label: string, position: THREE.Vector3, radius: number, color: number): void {
    const surface = new THREE.Mesh(
      new THREE.CylinderGeometry(radius, radius * 1.04, 0.4, 48),
      new THREE.MeshStandardMaterial({
        color,
        emissive: color,
        emissiveIntensity: type === "water" ? 0.32 : 0.85,
        transparent: true,
        opacity: type === "water" ? 0.78 : 0.86,
        roughness: type === "water" ? 0.12 : 0.4,
        metalness: type === "water" ? 0.22 : 0.08,
      }),
    );
    surface.position.copy(position);
    surface.position.y = 0.16;
    surface.receiveShadow = true;
    this.scene.add(surface);

    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(radius + 0.9, 0.28, 12, 60),
      new THREE.MeshStandardMaterial({
        color: type === "water" ? 0xcce9ff : 0xffd38f,
        emissive: color,
        emissiveIntensity: 0.68,
        roughness: 0.22,
      }),
    );
    ring.rotation.x = Math.PI * 0.5;
    ring.position.copy(position);
    ring.position.y = 0.28;
    this.scene.add(ring);

    const accent = new THREE.Group();
    const particles: THREE.Mesh[] = [];
    for (let index = 0; index < 10; index += 1) {
      const angle = (index / 10) * Math.PI * 2;
      const piece = new THREE.Mesh(
        new THREE.ConeGeometry(type === "water" ? 0.18 : 0.28, type === "fire" ? 1.9 : 1.25, 6),
        new THREE.MeshStandardMaterial({
          color: type === "fire" ? 0x4e2c16 : type === "water" ? 0xdcecff : 0x355432,
          emissive: type === "water" ? 0x7ccaff : color,
          emissiveIntensity: type === "water" ? 0.3 : 0.2,
          roughness: 0.74,
        }),
      );
      piece.position.set(Math.cos(angle) * (radius * 0.75), 0.7, Math.sin(angle) * (radius * 0.75));
      piece.rotation.x = type === "water" ? 0.08 : -0.1;
      accent.add(piece);
      particles.push(piece);
    }
    accent.position.copy(position);
    this.scene.add(accent);

    const light = new THREE.PointLight(color, type === "water" ? 2.2 : 4.5, radius * 3.8, 2);
    light.position.copy(position).add(new THREE.Vector3(0, type === "water" ? 2.4 : 3.1, 0));
    this.scene.add(light);

    this.hazards.push({
      type,
      label,
      position: position.clone(),
      radius,
      surface,
      ring,
      accent,
      light,
      particles,
      phase: Math.random() * Math.PI * 2,
    });
  }

  private bindEvents(): void {
    this.buttons.start.addEventListener("click", () => this.startNewRun());
    this.buttons.restart.addEventListener("click", () => this.startNewRun());
    this.buttons.retry.addEventListener("click", () => this.retryRun());
    this.buttons.abandon.addEventListener("click", () => this.finishRun("Run abandoned", false));

    this.buttons.attack.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      this.attackRequested = true;
    });
    this.buttons.dash.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      this.dashRequested = true;
    });

    window.addEventListener("resize", () => this.resize());
    window.addEventListener("keydown", (event) => {
      if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", " "].includes(event.key)) {
        event.preventDefault();
      }
      this.keyboardState.set(event.key.toLowerCase(), true);
      if (event.key === " ") {
        this.attackRequested = true;
      }
      if (event.key.toLowerCase() === "shift") {
        this.dashRequested = true;
      }
    });
    window.addEventListener("keyup", (event) => {
      this.keyboardState.set(event.key.toLowerCase(), false);
    });

    this.renderer.domElement.addEventListener("contextmenu", (event) => event.preventDefault());
    this.renderer.domElement.addEventListener("pointerdown", (event) => {
      if (event.button === 0) {
        this.attackRequested = true;
      }
    });

    this.joystick.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      this.joystickPointerId = event.pointerId;
      this.joystick.setPointerCapture(event.pointerId);
      this.updateJoystick(event);
    });
    this.joystick.addEventListener("pointermove", (event) => {
      if (this.joystickPointerId === event.pointerId) {
        this.updateJoystick(event);
      }
    });
    const clearJoystick = (event: PointerEvent) => {
      if (this.joystickPointerId !== event.pointerId) {
        return;
      }
      this.joystick.releasePointerCapture(event.pointerId);
      this.joystickPointerId = null;
      this.mobileMove.set(0, 0);
      this.joystickThumb.style.transform = "translate(-50%, -50%)";
    };
    this.joystick.addEventListener("pointerup", clearJoystick);
    this.joystick.addEventListener("pointercancel", clearJoystick);
  }

  private updateJoystick(event: PointerEvent): void {
    const bounds = this.joystick.getBoundingClientRect();
    const center = new THREE.Vector2(bounds.width / 2, bounds.height / 2);
    const local = new THREE.Vector2(event.clientX - bounds.left, event.clientY - bounds.top).sub(center);
    const clamped = clampVectorLength(local, bounds.width * 0.32);
    this.mobileMove.set(clamped.x / (bounds.width * 0.32), clamped.y / (bounds.width * 0.32));
    this.joystickThumb.style.transform = `translate(calc(-50% + ${clamped.x}px), calc(-50% + ${clamped.y}px))`;
  }

  private startNewRun(): void {
    this.clearDynamicState();

    const playerBundle = createPlayerMesh();
    playerBundle.group.position.copy(this.playerSpawn);
    this.dynamicGroup.add(playerBundle.group);

    const relicMesh = this.createRelicMesh();
    relicMesh.position.copy(this.relicPosition).add(new THREE.Vector3(0, 2.3, 0));
    this.dynamicGroup.add(relicMesh);

    this.buttons.retry.disabled = false;
    this.run = {
      player: {
        mesh: playerBundle.group,
        visual: playerBundle.visual,
        weapon: playerBundle.weapon,
        attackArc: playerBundle.attackArc,
        healthBar: playerBundle.healthBar,
        state: {
          maxHealth: 145,
          health: 145,
          speed: 10.2,
          damage: 62,
          reviveCost: GAME_CONFIG.retryCost,
        },
        facingAngle: 0,
        attackCooldown: 0,
        attackSwingTime: 0,
        dashCooldown: 0,
        dashTime: 0,
        dashDirection: new THREE.Vector3(0, 0, 1),
        invulnerability: 0,
        damageBuff: 0,
        speedBuff: 0,
        hurtTime: 0,
        radius: 1.15,
      },
      state: {
        survivalTime: 0,
        enemiesDefeated: 0,
        bossActive: false,
        bossDefeated: false,
        activeChallenges: createChallengeState(),
        revivalCount: 0,
      },
      elapsedSpawn: 0,
      bossSpawned: false,
      relic: { mesh: relicMesh, collected: false, bobTime: 0 },
    };

    this.spawnEnemy("melee");
    this.spawnEnemy("melee");
    this.spawnEnemy("spitter");
    this.spawnEnemy("melee");
    this.overlays.statusLine.textContent =
      "Rocks now block movement. Your strike is directional and visualized by the blue arc in front of you.";
    this.showOverlay("playing");
    this.updateHud();
  }

  private createRelicMesh(): THREE.Group {
    const group = new THREE.Group();
    const shard = new THREE.Mesh(
      new THREE.OctahedronGeometry(1.2, 0),
      new THREE.MeshStandardMaterial({
        color: 0xfff1a2,
        emissive: 0xffcb53,
        emissiveIntensity: 1.4,
        roughness: 0.16,
        metalness: 0.14,
      }),
    );
    shard.castShadow = true;
    group.add(shard);

    const halo = new THREE.Mesh(
      new THREE.TorusGeometry(1.55, 0.09, 8, 24),
      new THREE.MeshStandardMaterial({
        color: 0xfff5bf,
        emissive: 0xffd86d,
        emissiveIntensity: 1.1,
        roughness: 0.18,
      }),
    );
    halo.rotation.x = Math.PI * 0.5;
    group.add(halo);

    const glow = new THREE.PointLight(0xffcf67, 3.5, 16, 2);
    glow.position.y = 1.8;
    group.add(glow);
    return group;
  }

  private clearDynamicState(): void {
    this.enemies.length = 0;
    this.projectiles.length = 0;
    this.effects.length = 0;
    this.dynamicGroup.clear();
    this.run = null;
    this.attackRequested = false;
    this.dashRequested = false;
    this.mobileMove.set(0, 0);
  }

  private retryRun(): void {
    if (!this.run) {
      return;
    }
    if (this.profile.cash < GAME_CONFIG.retryCost) {
      this.finishRun("Broke and out of options", false);
      return;
    }

    this.profile.cash -= GAME_CONFIG.retryCost;
    saveProfile(this.profile);
    this.syncProfileUi();

    const player = this.run.player;
    player.state.health = player.state.maxHealth;
    player.mesh.position.copy(this.playerSpawn);
    player.facingAngle = 0;
    player.attackCooldown = 0.18;
    player.attackSwingTime = 0;
    player.dashCooldown = 0;
    player.dashTime = 0;
    player.invulnerability = 1.1;
    player.hurtTime = 0;
    this.run.state.revivalCount += 1;

    for (const projectile of this.projectiles) {
      this.dynamicGroup.remove(projectile.mesh);
    }
    this.projectiles.length = 0;
    this.overlays.statusLine.textContent = "Revived at the south gate. Use rocks and the outer wall to reset the fight.";
    this.showOverlay("playing");
  }

  private finishRun(reason: string, victory: boolean): void {
    if (!this.run) {
      return;
    }

    const survivalTime = this.run.state.survivalTime;
    this.profile.totalRuns += 1;
    this.profile.bestTime = Math.max(this.profile.bestTime, survivalTime);
    if (victory) {
      this.profile.bossDefeats += 1;
      this.profile.unlockedTitle = true;
      this.profile.cash += 550;
    }
    saveProfile(this.profile);
    this.syncProfileUi();

    this.resultRefs.title.textContent = victory ? "Boss defeated" : "Run ended";
    this.resultRefs.summary.textContent = `${reason} Survival: ${formatTime(survivalTime)}. Kills: ${this.run.state.enemiesDefeated}. Cash on hand: $${this.profile.cash}.`;
    this.showOverlay("result");
  }

  private showOverlay(mode: OverlayMode): void {
    this.overlayMode = mode;
    const hidden = "hidden";
    this.overlays.menu.classList.toggle(hidden, mode !== "menu");
    this.overlays.death.classList.toggle(hidden, mode !== "death");
    this.overlays.result.classList.toggle(hidden, mode !== "result");
    this.mobileControls.classList.toggle(hidden, !this.coarsePointer || mode !== "playing");
  }

  private syncProfileUi(): void {
    if (!Number.isFinite(this.profile.cash)) {
      this.profile = { ...DEFAULT_PROFILE };
      saveProfile(this.profile);
    }
    this.profileRefs.cash.textContent = `$${this.profile.cash}`;
    this.profileRefs.best.textContent = formatTime(this.profile.bestTime);
    this.profileRefs.runs.textContent = String(this.profile.totalRuns);
    this.profileRefs.bosses.textContent = String(this.profile.bossDefeats);
    this.hud.cash.textContent = `$${this.profile.cash}`;
  }

  private animate = (): void => {
    requestAnimationFrame(this.animate);
    const delta = Math.min(this.clock.getDelta(), 0.05);

    this.updateAmbientWorld(delta);
    if (this.overlayMode === "playing" && this.run) {
      this.updateRun(delta);
    } else {
      this.updateCamera(delta);
      this.updateEffects(delta);
      this.updateHealthBars();
    }

    this.composer.render();
  };

  private updateAmbientWorld(delta: number): void {
    for (const hazard of this.hazards) {
      hazard.phase += delta;
      hazard.ring.rotation.z += delta * (hazard.type === "water" ? 0.18 : 0.28);
      hazard.accent.rotation.y -= delta * 0.16;
      const pulse = 0.84 + Math.sin(hazard.phase * (hazard.type === "water" ? 1.4 : 2.4)) * 0.18;
      const surfaceMaterial = hazard.surface.material as THREE.MeshStandardMaterial;
      surfaceMaterial.emissiveIntensity = hazard.type === "water" ? 0.26 + pulse * 0.16 : 0.72 + pulse * 0.22;
      hazard.light.intensity = hazard.type === "water" ? 1.8 + pulse : 3.4 + pulse * 1.4;
      hazard.surface.scale.setScalar(1 + Math.sin(hazard.phase * 1.5) * 0.018);
      hazard.surface.scale.y = 1;
      hazard.particles.forEach((particle, index) => {
        particle.position.y = 0.5 + Math.sin(hazard.phase * 2.5 + index * 0.8) * (hazard.type === "water" ? 0.25 : 0.42);
        particle.rotation.y += delta * (0.5 + index * 0.08);
      });
    }
  }

  private updateRun(delta: number): void {
    if (!this.run) {
      return;
    }

    const run = this.run;
    run.state.survivalTime += delta;
    run.elapsedSpawn += delta;
    run.relic.bobTime += delta;
    run.relic.mesh.position.y = this.relicPosition.y + 2.3 + Math.sin(run.relic.bobTime * 1.8) * 0.34;
    run.relic.mesh.rotation.y += delta * 1.35;

    const player = run.player;
    player.attackCooldown = Math.max(0, player.attackCooldown - delta);
    player.attackSwingTime = Math.max(0, player.attackSwingTime - delta);
    player.dashCooldown = Math.max(0, player.dashCooldown - delta);
    player.invulnerability = Math.max(0, player.invulnerability - delta);
    player.damageBuff = Math.max(0, player.damageBuff - delta);
    player.speedBuff = Math.max(0, player.speedBuff - delta);
    player.hurtTime = Math.max(0, player.hurtTime - delta);

    const { throttle, turn } = this.readControlAxes();
    player.facingAngle -= turn * delta * 2.35;
    const forward = angleToForward(player.facingAngle).normalize();
    player.mesh.rotation.y = player.facingAngle;

    if (this.dashRequested && player.dashCooldown <= 0) {
      player.dashCooldown = 2;
      player.dashTime = 0.22;
      player.invulnerability = 0.45;
      player.dashDirection.copy(forward).multiplyScalar(throttle < -0.1 ? -1 : 1);
      this.createSlashEffect(player.mesh.position, forward, 0x92e9ff, 4.6);
    }

    if (player.dashTime > 0) {
      player.dashTime -= delta;
      player.mesh.position.addScaledVector(player.dashDirection, delta * 26);
    } else if (Math.abs(throttle) > 0.01) {
      const speed = player.state.speed + (player.speedBuff > 0 ? 2.8 : 0);
      const directionScale = throttle >= 0 ? speed : speed * 0.68;
      player.mesh.position.addScaledVector(forward, delta * directionScale * throttle);
    }

    this.resolveWorldCollision(player.mesh.position, player.radius);

    if (this.attackRequested && player.attackCooldown <= 0) {
      this.performPlayerAttack(forward);
    }
    this.attackRequested = false;
    this.dashRequested = false;

    this.updatePlayerPresentation(delta, throttle);
    this.handleHazards();
    if (this.overlayMode !== "playing") {
      return;
    }

    this.spawnEnemies();
    this.updateEnemies(delta);
    if (this.overlayMode !== "playing") {
      return;
    }
    this.updateProjectiles(delta);
    if (this.overlayMode !== "playing") {
      return;
    }
    this.updateEffects(delta);
    this.updateChallenges();
    this.updateCamera(delta);
    this.updateHealthBars();
    this.updateHud();
  }

  private readControlAxes(): { throttle: number; turn: number } {
    const forward =
      (this.keyboardState.get("w") || this.keyboardState.get("arrowup") ? 1 : 0) -
      (this.keyboardState.get("s") || this.keyboardState.get("arrowdown") ? 1 : 0);
    const steer =
      (this.keyboardState.get("d") || this.keyboardState.get("arrowright") ? 1 : 0) -
      (this.keyboardState.get("a") || this.keyboardState.get("arrowleft") ? 1 : 0);

    return {
      throttle: THREE.MathUtils.clamp(forward - this.mobileMove.y, -1, 1),
      turn: THREE.MathUtils.clamp(steer + this.mobileMove.x, -1, 1),
    };
  }

  private updatePlayerPresentation(delta: number, throttle: number): void {
    if (!this.run) {
      return;
    }

    const player = this.run.player;
    const attackMaterial = player.attackArc.material as THREE.MeshBasicMaterial;
    const stride = Math.abs(throttle) > 0.05 ? Math.sin(performance.now() * 0.015) * 0.08 * Math.sign(throttle) : 0;
    const bob = Math.abs(throttle) > 0.05 ? Math.sin(performance.now() * 0.022) * 0.06 : 0;
    const hurtLean = player.hurtTime > 0 ? Math.sin(player.hurtTime * 46) * 0.16 : 0;

    if (player.attackSwingTime > 0) {
      const progress = 1 - player.attackSwingTime / 0.26;
      const windUpProgress = Math.min(progress / 0.24, 1);
      const releaseProgress = progress <= 0.24 ? 0 : (progress - 0.24) / 0.76;
      const swing =
        progress <= 0.24
          ? THREE.MathUtils.lerp(-0.55, -1.95, windUpProgress)
          : THREE.MathUtils.lerp(-1.95, 1.36, releaseProgress);

      player.weapon.rotation.z = swing;
      player.weapon.rotation.x = 0.18 + Math.sin(progress * Math.PI) * 0.6;
      player.weapon.position.x = 1.15 + Math.sin(progress * Math.PI) * 0.16;
      player.weapon.position.y = 1.62 + Math.sin(progress * Math.PI) * 0.14;
      player.visual.rotation.y = THREE.MathUtils.lerp(0.24, -0.58, progress);
      player.visual.rotation.z = hurtLean + Math.sin(progress * Math.PI) * 0.08;
      player.visual.position.z = -0.08 + Math.sin(progress * Math.PI) * 0.24;
      player.visual.position.y = bob;

      player.attackArc.visible = true;
      attackMaterial.opacity = 0.22 + Math.sin(progress * Math.PI) * 0.34;
      player.attackArc.scale.setScalar(1 + Math.sin(progress * Math.PI) * 0.16);
    } else {
      player.weapon.rotation.z = THREE.MathUtils.lerp(player.weapon.rotation.z, -0.55, 1 - Math.exp(-delta * 14));
      player.weapon.rotation.x = THREE.MathUtils.lerp(player.weapon.rotation.x, 0, 1 - Math.exp(-delta * 14));
      player.weapon.position.x = THREE.MathUtils.lerp(player.weapon.position.x, 1.15, 1 - Math.exp(-delta * 14));
      player.weapon.position.y = THREE.MathUtils.lerp(player.weapon.position.y, 1.62, 1 - Math.exp(-delta * 14));
      player.visual.rotation.y = THREE.MathUtils.lerp(player.visual.rotation.y, 0, 1 - Math.exp(-delta * 12));
      player.visual.rotation.z = THREE.MathUtils.lerp(player.visual.rotation.z, hurtLean, 1 - Math.exp(-delta * 18));
      player.visual.position.z = THREE.MathUtils.lerp(player.visual.position.z, 0, 1 - Math.exp(-delta * 14));
      player.visual.position.y = bob;
      attackMaterial.opacity = THREE.MathUtils.lerp(attackMaterial.opacity, 0, 1 - Math.exp(-delta * 20));
      player.attackArc.scale.lerp(new THREE.Vector3(1, 1, 1), 1 - Math.exp(-delta * 16));
      if (attackMaterial.opacity < 0.02) {
        player.attackArc.visible = false;
      }
    }

    player.visual.rotation.x = stride;
  }

  private updateCamera(delta: number): void {
    if (this.run) {
      const player = this.run.player;
      const forward = angleToForward(player.facingAngle).normalize();
      const desiredPosition = player.mesh.position.clone().addScaledVector(forward, -13.5).add(new THREE.Vector3(0, 7.6, 0));
      this.camera.position.lerp(desiredPosition, 1 - Math.exp(-delta * 5.6));
      this.cameraFocus.copy(player.mesh.position).addScaledVector(forward, 7.6).add(new THREE.Vector3(0, 2.4, 0));
      this.camera.lookAt(this.cameraFocus);
      return;
    }

    this.camera.position.lerp(new THREE.Vector3(0, 11, -18), 1 - Math.exp(-delta * 2.8));
    this.camera.lookAt(0, 3, 0);
  }

  private updateHealthBars(): void {
    if (this.run) {
      updateHealthBar(this.run.player.healthBar, this.run.player.state.health / this.run.player.state.maxHealth, this.camera);
    }
    for (const enemy of this.enemies) {
      updateHealthBar(enemy.healthBar, enemy.health / enemy.maxHealth, this.camera);
    }
  }

  private performPlayerAttack(forward: THREE.Vector3): void {
    if (!this.run) {
      return;
    }

    const player = this.run.player;
    player.attackCooldown = 0.34;
    player.attackSwingTime = 0.26;
    const damage = player.state.damage + (player.damageBuff > 0 ? 24 : 0);
    let hitCount = 0;

    this.createSlashEffect(player.mesh.position, forward, player.damageBuff > 0 ? 0xffe173 : 0x8ff0ff, 7.1);

    for (const enemy of this.enemies) {
      const offset = enemy.mesh.position.clone().sub(player.mesh.position);
      offset.y = 0;
      const distance = offset.length();
      if (distance > (enemy.type === "boss" ? 8.4 : 6.6)) {
        continue;
      }
      const alignment = distance > 0.001 ? offset.normalize().dot(forward) : 1;
      if (alignment < 0.45) {
        continue;
      }
      enemy.health -= damage;
      enemy.hurtTime = 0.24;
      enemy.velocity.addScaledVector(forward, enemy.type === "boss" ? 4.8 : 10.2);
      this.createSpark(enemy.mesh.position, enemy.type === "boss" ? 0xff7e92 : 0xb0f1ff);
      hitCount += 1;
    }

    this.overlays.statusLine.textContent =
      hitCount > 0
        ? `Front arc strike connected with ${hitCount} target${hitCount > 1 ? "s" : ""}.`
        : "Front arc strike missed. It only hits in the direction you are facing.";
  }

  private createSlashEffect(position: THREE.Vector3, forward: THREE.Vector3, color: number, size: number): void {
    const yaw = Math.atan2(forward.x, forward.z);
    const makeArc = (inner: number, outer: number, opacity: number, yOffset: number, life: number, growth: number) => {
      const arc = new THREE.Mesh(
        new THREE.RingGeometry(inner, outer, 44, 1, -1.1, 2.2),
        new THREE.MeshStandardMaterial({
          color,
          emissive: color,
          emissiveIntensity: 1.7,
          transparent: true,
          opacity,
          roughness: 0.08,
          metalness: 0.18,
          side: THREE.DoubleSide,
        }),
      );
      arc.position.copy(position).add(new THREE.Vector3(0, yOffset, 0));
      arc.rotation.set(-Math.PI * 0.5, yaw - Math.PI * 0.5, 0);
      this.dynamicGroup.add(arc);
      this.effects.push({ mesh: arc, life, maxLife: life, scaleGrowth: growth });
    };

    makeArc(1.35, size * 0.92, 0.62, 0.08, 0.18, 0.22);
    makeArc(0.9, size * 0.72, 0.45, 0.22, 0.24, 0.34);
    makeArc(0.55, size * 0.48, 0.26, 0.38, 0.28, 0.46);


  }

  private createSpark(position: THREE.Vector3, color: number): void {
    const spark = new THREE.Mesh(
      new THREE.IcosahedronGeometry(0.24, 0),
      new THREE.MeshStandardMaterial({
        color,
        emissive: color,
        emissiveIntensity: 1.5,
        transparent: true,
        opacity: 1,
      }),
    );
    spark.position.copy(position).add(new THREE.Vector3(0, 2.2, 0));
    this.dynamicGroup.add(spark);
    this.effects.push({
      mesh: spark,
      life: 0.35,
      maxLife: 0.35,
      drift: new THREE.Vector3((Math.random() - 0.5) * 2, 1.6, (Math.random() - 0.5) * 2),
      scaleGrowth: 1.9,
    });
  }

  private createHazardBurst(type: HazardType, position: THREE.Vector3): void {
    if (type === "water") {
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(2.5, 0.18, 8, 30),
        new THREE.MeshStandardMaterial({ color: 0xcdefff, emissive: 0x78cfff, emissiveIntensity: 1.2, transparent: true, opacity: 0.9 }),
      );
      ring.rotation.x = Math.PI * 0.5;
      ring.position.copy(position).add(new THREE.Vector3(0, 0.2, 0));
      this.dynamicGroup.add(ring);
      this.effects.push({ mesh: ring, life: 0.6, maxLife: 0.6, scaleGrowth: 2.8 });
      for (let index = 0; index < 8; index += 1) {
        const drop = new THREE.Mesh(
          new THREE.SphereGeometry(0.24, 10, 10),
          new THREE.MeshStandardMaterial({ color: 0xbcecff, emissive: 0x5fb8ff, emissiveIntensity: 0.9, transparent: true, opacity: 0.95 }),
        );
        const angle = (index / 8) * Math.PI * 2;
        drop.position.copy(position).add(new THREE.Vector3(Math.cos(angle), 0.6, Math.sin(angle)));
        this.dynamicGroup.add(drop);
        this.effects.push({ mesh: drop, life: 0.7, maxLife: 0.7, drift: new THREE.Vector3(Math.cos(angle) * 2.6, 2.6, Math.sin(angle) * 2.6), scaleGrowth: 1.2 });
      }
      return;
    }

    if (type === "fire") {
      for (let index = 0; index < 6; index += 1) {
        const flame = new THREE.Mesh(
          new THREE.ConeGeometry(0.45, 2.4, 6),
          new THREE.MeshStandardMaterial({ color: 0xffb06a, emissive: 0xff6b2d, emissiveIntensity: 1.3, transparent: true, opacity: 0.92 }),
        );
        const angle = (index / 6) * Math.PI * 2;
        flame.position.copy(position).add(new THREE.Vector3(Math.cos(angle) * 0.8, 1, Math.sin(angle) * 0.8));
        this.dynamicGroup.add(flame);
        this.effects.push({ mesh: flame, life: 0.55, maxLife: 0.55, drift: new THREE.Vector3(Math.cos(angle) * 0.8, 3.4, Math.sin(angle) * 0.8), scaleGrowth: 1.6 });
      }
      return;
    }

    for (let index = 0; index < 8; index += 1) {
      const bubble = new THREE.Mesh(
        new THREE.SphereGeometry(0.25, 10, 10),
        new THREE.MeshStandardMaterial({ color: 0x9cff9f, emissive: 0x4bd567, emissiveIntensity: 1.1, transparent: true, opacity: 0.9 }),
      );
      const angle = (index / 8) * Math.PI * 2;
      bubble.position.copy(position).add(new THREE.Vector3(Math.cos(angle) * 0.9, 0.5, Math.sin(angle) * 0.9));
      this.dynamicGroup.add(bubble);
      this.effects.push({ mesh: bubble, life: 0.75, maxLife: 0.75, drift: new THREE.Vector3(Math.cos(angle) * 1.2, 2.2, Math.sin(angle) * 1.2), scaleGrowth: 1.8 });
    }
  }

  private handleHazards(): void {
    if (!this.run) {
      return;
    }

    const playerPos = this.run.player.mesh.position;
    for (const hazard of this.hazards) {
      const horizontalDistance = Math.hypot(playerPos.x - hazard.position.x, playerPos.z - hazard.position.z);
      if (horizontalDistance > hazard.radius - 0.5) {
        continue;
      }

      this.createHazardBurst(hazard.type, playerPos.clone());
      if (hazard.type === "water") {
        this.overlays.statusLine.textContent = "The drowning basin swallowed the whole run.";
        this.finishRun(`Drowned in ${hazard.label.toLowerCase()}.`, false);
        return;
      }

      this.deathRefs.title.textContent = hazard.type === "fire" ? "Consumed by lava" : "Poisoned out";
      this.deathRefs.summary.textContent =
        this.profile.cash >= GAME_CONFIG.retryCost
          ? `You can pay $${GAME_CONFIG.retryCost} to revive back at the south gate.`
          : "You do not have enough cash to revive.";
      this.buttons.retry.disabled = this.profile.cash < GAME_CONFIG.retryCost;
      this.showOverlay("death");
      return;
    }
  }

  private spawnEnemies(): void {
    if (!this.run || this.overlayMode !== "playing") {
      return;
    }

    const activeNonBoss = this.enemies.filter((enemy) => enemy.type !== "boss").length;
    const liveCap = this.run.state.bossActive ? 8 : 6;
    const interval = this.run.state.survivalTime > 95 ? 3 : 3.8;
    if (activeNonBoss < liveCap && this.run.elapsedSpawn >= interval) {
      this.run.elapsedSpawn = 0;
      const type: EnemyArchetype = Math.random() > 0.58 ? "spitter" : "melee";
      this.spawnEnemy(type);
    }

    const completedChallenges = this.run.state.activeChallenges.filter((challenge) => challenge.completed).length;
    const shouldSpawnBoss =
      !this.run.bossSpawned &&
      (this.run.state.survivalTime >= GAME_CONFIG.bossSpawnTime ||
        completedChallenges >= GAME_CONFIG.challengeCountForBoss);

    if (shouldSpawnBoss) {
      this.spawnEnemy("boss");
      this.run.bossSpawned = true;
      this.run.state.bossActive = true;
      this.overlays.statusLine.textContent = "The altar has opened. The hall king is coming.";
    }
  }

  private spawnEnemy(type: EnemyArchetype): void {
    const built = createEnemyMesh(type);
    const mesh = built.group;
    const playerPosition = this.run?.player.mesh.position ?? this.playerSpawn;
    const spawn = new THREE.Vector3();

    if (type === "boss") {
      spawn.copy(this.altarPosition).add(new THREE.Vector3(0, 0, -4));
    } else {
      for (let attempt = 0; attempt < 24; attempt += 1) {
        const angle = Math.random() * Math.PI * 2;
        const radius = 28 + Math.random() * 18;
        spawn.copy(playerPosition).add(new THREE.Vector3(Math.cos(angle) * radius, 0, Math.sin(angle) * radius));
        this.resolveBoundary(spawn, 1.2);
        const nearHazard = this.hazards.some(
          (hazard) => Math.hypot(spawn.x - hazard.position.x, spawn.z - hazard.position.z) < hazard.radius + 5,
        );
        const nearRock = this.obstacles.some((obstacle) => obstacle.position.distanceTo(spawn) < obstacle.radius + 3);
        if (!nearHazard && !nearRock) {
          break;
        }
      }
    }

    mesh.position.copy(spawn);
    this.dynamicGroup.add(mesh);
    this.enemies.push({
      type,
      title: type === "melee" ? "Grin hound" : type === "spitter" ? "Watcher" : "Hall king",
      mesh,
      visual: built.visual,
      rig: built.rig,
      healthBar: built.healthBar,
      velocity: new THREE.Vector3(),
      health: type === "boss" ? 420 : type === "spitter" ? 66 : 44,
      maxHealth: type === "boss" ? 420 : type === "spitter" ? 66 : 44,
      speed: type === "boss" ? 3.8 : type === "spitter" ? 4.6 : 6.9,
      attackCooldown: type === "boss" ? 2.1 : type === "spitter" ? 2.5 : 1.25,
      lifetime: 0,
      phase: Math.random() * Math.PI * 2,
      orbitDirection: Math.random() > 0.5 ? 1 : -1,
      radius: type === "boss" ? 3.8 : type === "spitter" ? 1.5 : 1.25,
      hurtTime: 0,
    });
  }

  private updateEnemies(delta: number): void {
    if (!this.run) {
      return;
    }

    const playerPos = this.run.player.mesh.position;
    for (let index = this.enemies.length - 1; index >= 0; index -= 1) {
      const enemy = this.enemies[index];
      enemy.lifetime += delta;
      enemy.attackCooldown -= delta;
      enemy.hurtTime = Math.max(0, enemy.hurtTime - delta);
      this.animateEnemy(enemy, delta);

      const toPlayer = playerPos.clone().sub(enemy.mesh.position);
      const distance = Math.max(0.001, toPlayer.length());
      const direction = toPlayer.clone().normalize();
      const lateral = new THREE.Vector3(-direction.z, 0, direction.x);

      if (enemy.type === "melee") {
        enemy.velocity.addScaledVector(direction, delta * enemy.speed * (2.6 + Math.sin(enemy.lifetime * 8 + enemy.phase) * 0.35));
        enemy.velocity.addScaledVector(lateral, delta * Math.sin(enemy.lifetime * 5 + enemy.phase) * 2.8);
        if (distance < 2.7 && enemy.attackCooldown <= 0) {
          enemy.attackCooldown = 1.5;
          this.damagePlayer(11, "A grin hound got through your guard.");
        }
      } else if (enemy.type === "spitter") {
        if (distance > 18) {
          enemy.velocity.addScaledVector(direction, delta * enemy.speed * 2.2);
        } else if (distance < 9) {
          enemy.velocity.addScaledVector(direction, -delta * enemy.speed * 2);
        }
        enemy.velocity.addScaledVector(lateral, delta * enemy.orbitDirection * enemy.speed * 1.7);
        if (distance < 24 && enemy.attackCooldown <= 0) {
          enemy.attackCooldown = 2.8;
          this.spawnProjectile(
            enemy.mesh.position.clone().add(new THREE.Vector3(0, 2.1, 0)),
            direction,
            11.5,
            10,
            0x9ce9ff,
          );
        }
      } else {
        enemy.velocity.addScaledVector(direction, delta * enemy.speed * 1.85);
        if (distance < 5.8 && enemy.attackCooldown <= 0) {
          enemy.attackCooldown = 2.35;
          this.damagePlayer(15, "The hall king crushed you with a close swing.");
          this.createSlashEffect(enemy.mesh.position, direction, 0xff7d92, 7);
        } else if (enemy.attackCooldown <= 0) {
          enemy.attackCooldown = 3.1;
          for (let boltIndex = 0; boltIndex < 10; boltIndex += 1) {
            const angle = (boltIndex / 10) * Math.PI * 2 + enemy.lifetime * 0.7;
            const boltDirection = new THREE.Vector3(Math.cos(angle), 0, Math.sin(angle));
            this.spawnProjectile(enemy.mesh.position.clone().add(new THREE.Vector3(0, 4.5, 0)), boltDirection, 9.4, 12, 0xff7d92);
          }
        }
      }

      enemy.velocity.multiplyScalar(0.86);
      enemy.mesh.position.addScaledVector(enemy.velocity, delta);
      this.resolveWorldCollision(enemy.mesh.position, enemy.radius);
      enemy.mesh.lookAt(playerPos.x, enemy.mesh.position.y + 2, playerPos.z);

      if (enemy.health <= 0) {
        this.handleEnemyDefeat(index);
      }
    }
  }

  private animateEnemy(enemy: EnemyInstance, delta: number): void {
    const hurtWobble = enemy.hurtTime > 0 ? Math.sin(enemy.hurtTime * 42) * 0.22 : 0;
    enemy.visual.rotation.z = hurtWobble;
    enemy.visual.scale.setScalar(enemy.hurtTime > 0 ? 1.04 : 1);

    if (enemy.type === "melee") {
      if (enemy.rig.jaw) {
        enemy.rig.jaw.rotation.x = 0.2 + Math.sin(enemy.lifetime * 12 + enemy.phase) * 0.18;
      }
      enemy.rig.limbs?.forEach((limb, index) => {
        limb.rotation.x = Math.sin(enemy.lifetime * 10 + index) * 0.4;
      });
      enemy.rig.extra?.forEach((spike, index) => {
        spike.rotation.z = Math.sin(enemy.lifetime * 5 + index) * 0.08;
      });
      return;
    }

    if (enemy.type === "spitter") {
      if (enemy.rig.eye) {
        enemy.rig.eye.position.y = 2.1 + Math.sin(enemy.lifetime * 3.2 + enemy.phase) * 0.55;
      }
      if (enemy.rig.halo) {
        enemy.rig.halo.rotation.z += delta * 1.4;
      }
      enemy.rig.limbs?.forEach((limb, index) => {
        limb.rotation.x = -0.4 + Math.sin(enemy.lifetime * 4 + index) * 0.35;
      });
      return;
    }

    if (enemy.rig.halo) {
      enemy.rig.halo.rotation.z += delta * 0.9;
      enemy.rig.halo.position.y = 4.2 + Math.sin(enemy.lifetime * 2.6) * 0.25;
    }
    if (enemy.rig.eye) {
      enemy.rig.eye.position.y = 4.5 + Math.sin(enemy.lifetime * 3.8) * 0.16;
    }
    enemy.rig.extra?.forEach((part, index) => {
      part.rotation.y += delta * (0.5 + index * 0.03);
    });
  }

  private handleEnemyDefeat(index: number): void {
    if (!this.run) {
      return;
    }

    const [enemy] = this.enemies.splice(index, 1);
    this.createSpark(enemy.mesh.position, enemy.type === "boss" ? 0xff8691 : enemy.type === "spitter" ? 0xa6f1ff : 0xc1e8ff);
    this.dynamicGroup.remove(enemy.mesh);
    this.profile.cash += enemy.type === "boss" ? 360 : enemy.type === "spitter" ? 40 : 28;
    saveProfile(this.profile);
    this.syncProfileUi();

    if (enemy.type === "boss") {
      this.run.state.bossActive = false;
      this.run.state.bossDefeated = true;
      this.overlays.statusLine.textContent = "The hall king collapsed. The arena is yours.";
      this.finishRun("You survived the night and broke the boss.", true);
      return;
    }

    this.run.state.enemiesDefeated += 1;
  }

  private spawnProjectile(origin: THREE.Vector3, direction: THREE.Vector3, speed: number, damage: number, color: number): void {
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(0.34, 14, 14),
      new THREE.MeshStandardMaterial({
        color,
        emissive: color,
        emissiveIntensity: 1.4,
        roughness: 0.16,
      }),
    );
    mesh.position.copy(origin);
    this.dynamicGroup.add(mesh);
    this.projectiles.push({
      mesh,
      velocity: direction.clone().normalize().multiplyScalar(speed),
      life: 3.2,
      damage,
    });
  }

  private updateProjectiles(delta: number): void {
    if (!this.run) {
      return;
    }

    const playerTarget = this.run.player.mesh.position.clone().add(new THREE.Vector3(0, 1.6, 0));
    for (let index = this.projectiles.length - 1; index >= 0; index -= 1) {
      const projectile = this.projectiles[index];
      projectile.life -= delta;
      projectile.mesh.position.addScaledVector(projectile.velocity, delta);

      if (projectile.mesh.position.distanceTo(playerTarget) < 1.28) {
        this.damagePlayer(projectile.damage, "A watcher blast slipped past your strike.");
        this.dynamicGroup.remove(projectile.mesh);
        this.projectiles.splice(index, 1);
        continue;
      }

      const rockHit = this.obstacles.some(
        (obstacle) => obstacle.position.distanceTo(projectile.mesh.position) < obstacle.radius + 0.35,
      );
      if (rockHit || projectile.mesh.position.length() > this.boundaryRadius) {
        this.dynamicGroup.remove(projectile.mesh);
        this.projectiles.splice(index, 1);
        continue;
      }

      if (projectile.life <= 0) {
        this.dynamicGroup.remove(projectile.mesh);
        this.projectiles.splice(index, 1);
      }
    }
  }

  private updateEffects(delta: number): void {
    for (let index = this.effects.length - 1; index >= 0; index -= 1) {
      const effect = this.effects[index];
      effect.life -= delta;
      const progress = 1 - effect.life / effect.maxLife;
      effect.mesh.scale.setScalar(1 + progress * effect.scaleGrowth);
      if (effect.drift) {
        effect.mesh.position.addScaledVector(effect.drift, delta);
      }
      if (effect.mesh instanceof THREE.Mesh) {
        const material = effect.mesh.material as THREE.MeshStandardMaterial;
        material.opacity = Math.max(0, effect.life / effect.maxLife);
      }
      if (effect.life <= 0) {
        this.dynamicGroup.remove(effect.mesh);
        this.effects.splice(index, 1);
      }
    }
  }

  private updateChallenges(): void {
    if (!this.run) {
      return;
    }

    const runState = this.run.state;
    const player = this.run.player;
    const relicDistance = this.run.relic.mesh.position.distanceTo(player.mesh.position);
    let profileChanged = false;

    for (const challenge of runState.activeChallenges) {
      if (challenge.completed) {
        continue;
      }

      if (challenge.id === "survive-minute") {
        challenge.progressText = `${Math.min(75, Math.floor(runState.survivalTime))}/75s`;
        if (runState.survivalTime >= 75) {
          challenge.completed = true;
          challenge.progressText = "Complete";
          this.profile.cash += challenge.rewardCash;
          player.state.health = player.state.maxHealth;
          profileChanged = true;
          this.overlays.statusLine.textContent = "Hold the Line cleared. Armor and health reset.";
        }
      }

      if (challenge.id === "slay-pack") {
        challenge.progressText = `${Math.min(10, runState.enemiesDefeated)}/10 kills`;
        if (runState.enemiesDefeated >= 10) {
          challenge.completed = true;
          challenge.progressText = "Complete";
          this.profile.cash += challenge.rewardCash;
          player.damageBuff = 999;
          profileChanged = true;
          this.overlays.statusLine.textContent = "Break the Pack cleared. Your strikes are overcharged.";
        }
      }

      if (challenge.id === "claim-relic") {
        challenge.progressText = relicDistance < 3.6 ? "Claiming" : "Ridge";
        if (!this.run.relic.collected && relicDistance < 3.6) {
          this.run.relic.collected = true;
          challenge.completed = true;
          challenge.progressText = "Complete";
          this.profile.cash += challenge.rewardCash;
          player.speedBuff = 999;
          profileChanged = true;
          this.dynamicGroup.remove(this.run.relic.mesh);
          this.overlays.statusLine.textContent = "Ridge relic claimed. Speed surge engaged.";
        }
      }
    }

    if (profileChanged) {
      saveProfile(this.profile);
      this.syncProfileUi();
    }
    this.renderChallengeList(runState.activeChallenges);
  }

  private damagePlayer(amount: number, status: string): void {
    if (!this.run) {
      return;
    }

    const player = this.run.player;
    if (player.invulnerability > 0) {
      return;
    }

    player.state.health = Math.max(0, player.state.health - amount);
    player.invulnerability = 0.45;
    player.hurtTime = 0.28;
    this.overlays.statusLine.textContent = status;
    if (player.state.health <= 0) {
      this.deathRefs.title.textContent = "Critical failure";
      this.deathRefs.summary.textContent =
        this.profile.cash >= GAME_CONFIG.retryCost
          ? `Spend $${GAME_CONFIG.retryCost} to revive at the south gate, or end the run.`
          : "You cannot afford a revival. The run ends here.";
      this.buttons.retry.disabled = this.profile.cash < GAME_CONFIG.retryCost;
      this.showOverlay("death");
    }
  }

  private renderChallengeList(challenges: ChallengeProgress[]): void {
    this.hud.challengeList.innerHTML = "";
    for (const challenge of challenges) {
      const item = document.createElement("article");
      item.className = `challenge-item compact-item ${challenge.completed ? "complete" : ""}`;
      item.innerHTML = `<strong>${challenge.title}</strong><span>${challenge.progressText}</span>`;
      this.hud.challengeList.appendChild(item);
    }
  }

  private updateHud(): void {
    if (!this.run) {
      this.hud.time.textContent = "0:00";
      this.hud.health.textContent = "0 / 0";
      this.hud.kills.textContent = "0";
      this.hud.boss.textContent = "Dormant";
      return;
    }

    this.hud.time.textContent = formatTime(this.run.state.survivalTime);
    this.hud.health.textContent = `${Math.ceil(this.run.player.state.health)} / ${this.run.player.state.maxHealth}`;
    this.hud.kills.textContent = String(this.run.state.enemiesDefeated);
    this.hud.boss.textContent = this.run.state.bossActive
      ? "Awake"
      : this.run.bossSpawned
        ? "Broken"
        : this.run.state.survivalTime > 80
          ? "Stirring"
          : "Dormant";
    this.hud.cash.textContent = `$${this.profile.cash}`;
  }

  private resolveWorldCollision(position: THREE.Vector3, radius: number): void {
    this.resolveBoundary(position, radius);
    for (const obstacle of this.obstacles) {
      const offset = new THREE.Vector2(position.x - obstacle.position.x, position.z - obstacle.position.z);
      const minDistance = obstacle.radius + radius;
      const distanceSq = offset.lengthSq();
      if (distanceSq >= minDistance * minDistance) {
        continue;
      }
      const distance = Math.max(0.001, Math.sqrt(distanceSq));
      offset.multiplyScalar(minDistance / distance);
      position.x = obstacle.position.x + offset.x;
      position.z = obstacle.position.z + offset.y;
    }
  }

  private resolveBoundary(position: THREE.Vector3, radius: number): void {
    const horizontal = new THREE.Vector2(position.x, position.z);
    const maxRadius = this.boundaryRadius - radius;
    if (horizontal.lengthSq() <= maxRadius * maxRadius) {
      return;
    }
    horizontal.normalize().multiplyScalar(maxRadius);
    position.x = horizontal.x;
    position.z = horizontal.y;
  }

  private resize(): void {
    const width = this.stage.clientWidth || window.innerWidth;
    const height = this.stage.clientHeight || window.innerHeight;
    this.renderer.setSize(width, height);
    this.composer.setSize(width, height);
    this.bloomPass.setSize(width, height);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }
}










