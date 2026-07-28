/**
 * Roadmap monitor: the leaning panel that displays the five baccarat roads.
 *
 * The screen is an emissive surface rather than a lit one, because a real LCD
 * emits light and would otherwise read as dark grey under the studio rig.
 */
import * as THREE from "three";
import type { CasinoId, CasinoTheme } from "../specs/casino-theme.js";
import {
  ROADMAP_MONITOR_DIMENSIONS_MM,
  ROADMAP_MONITOR_SIZE,
  millimetresToMetres,
} from "../specs/dimensions.js";
import { buildRoadmapView, type RoundResult } from "../specs/roadmap.js";
import { createRoadmapScreenTexture } from "../textures/furniture-textures.js";

export interface RoadmapMonitorOptions {
  readonly theme: CasinoTheme;
  readonly casinoId: CasinoId;
  readonly results: readonly RoundResult[];
}

export function createRoadmapMonitor(
  options: RoadmapMonitorOptions,
): THREE.Group {
  const { theme, casinoId, results } = options;
  const monitor = new THREE.Group();
  monitor.name = `roadmap-monitor-${casinoId}`;

  const roadmap = buildRoadmapView(results);
  const screenTexture = createRoadmapScreenTexture(roadmap, theme);

  const bezelWidth = ROADMAP_MONITOR_SIZE.bezelWidth;
  const bodyWidth = ROADMAP_MONITOR_SIZE.screenWidth + bezelWidth * 2;
  const bodyHeight = ROADMAP_MONITOR_SIZE.screenHeight + bezelWidth * 2;
  const bodyDepth = ROADMAP_MONITOR_SIZE.bodyDepth;

  const bezelMaterial = new THREE.MeshStandardMaterial({
    color: "#14161B",
    roughness: 0.45,
    metalness: 0.5,
  });

  const body = new THREE.Mesh(
    new THREE.BoxGeometry(bodyWidth, bodyHeight, bodyDepth),
    bezelMaterial,
  );
  body.name = "monitor-body";
  body.castShadow = true;
  body.receiveShadow = true;

  // Emissive so the panel reads as a backlit LCD rather than painted plastic.
  const screenMaterial = new THREE.MeshStandardMaterial({
    map: screenTexture,
    emissive: new THREE.Color("#FFFFFF"),
    emissiveMap: screenTexture,
    emissiveIntensity: 0.85,
    roughness: 0.22,
    metalness: 0,
  });
  const screen = new THREE.Mesh(
    new THREE.PlaneGeometry(
      ROADMAP_MONITOR_SIZE.screenWidth,
      ROADMAP_MONITOR_SIZE.screenHeight,
    ),
    screenMaterial,
  );
  screen.name = "monitor-screen";
  // Sit the glass a hair in front of the bezel to avoid z-fighting.
  screen.position.z = bodyDepth / 2 + millimetresToMetres(0.4);

  const panel = new THREE.Group();
  panel.name = "monitor-panel";
  panel.add(body);
  panel.add(screen);
  panel.rotation.x = (-ROADMAP_MONITOR_DIMENSIONS_MM.leanDegrees * Math.PI) / 180;
  panel.position.y = bodyHeight / 2;
  monitor.add(panel);

  const standDepth = bodyDepth * 2.6;
  const standHeight = millimetresToMetres(10);
  const stand = new THREE.Mesh(
    new THREE.BoxGeometry(bodyWidth * 0.82, standHeight, standDepth),
    bezelMaterial,
  );
  stand.name = "monitor-stand";
  stand.position.set(0, standHeight / 2, standDepth * 0.2);
  stand.castShadow = true;
  stand.receiveShadow = true;
  monitor.add(stand);

  monitor.userData = {
    kind: "roadmap-monitor",
    casinoId,
    roundCount: results.length,
    bankerWins: roadmap.bankerWins,
    playerWins: roadmap.playerWins,
    ties: roadmap.ties,
  };
  return monitor;
}
