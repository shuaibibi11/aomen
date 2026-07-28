/**
 * Canvas-drawn textures for chip inlays.
 *
 * Chip faces are drawn procedurally rather than loaded as image files so a new
 * casino only needs a theme entry, with no art pipeline step.
 */
import * as THREE from "three";
import type { CasinoTheme } from "../specs/casino-theme.js";
import { getDenominationStyle, getMouldProfile } from "../specs/denominations.js";

const CHIP_FACE_TEXTURE_SIZE = 512;

function createCanvas(size: number): {
  canvas: HTMLCanvasElement;
  context: CanvasRenderingContext2D;
} {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d");
  if (context === null) {
    throw new Error("2D canvas context unavailable");
  }
  return { canvas, context };
}

function drawRingGrooves(
  context: CanvasRenderingContext2D,
  centre: number,
  outerRadius: number,
  grooveCount: number,
  strokeColour: string,
): void {
  context.strokeStyle = strokeColour;
  for (let grooveIndex = 0; grooveIndex < grooveCount; grooveIndex += 1) {
    const radius = outerRadius * (0.74 - grooveIndex * 0.055);
    context.globalAlpha = 0.35 - grooveIndex * 0.05;
    context.lineWidth = outerRadius * 0.012;
    context.beginPath();
    context.arc(centre, centre, radius, 0, Math.PI * 2);
    context.stroke();
  }
  context.globalAlpha = 1;
}

function drawEdgeInserts(
  context: CanvasRenderingContext2D,
  centre: number,
  outerRadius: number,
  insertCount: number,
  insertWidthRatio: number,
  insertColour: string,
): void {
  const slotAngle = (Math.PI * 2) / insertCount;
  const insertAngle = slotAngle * insertWidthRatio;
  const innerRadius = outerRadius * 0.78;

  context.fillStyle = insertColour;
  for (let insertIndex = 0; insertIndex < insertCount; insertIndex += 1) {
    const startAngle = insertIndex * slotAngle - insertAngle / 2;
    context.beginPath();
    context.arc(centre, centre, outerRadius, startAngle, startAngle + insertAngle);
    context.arc(
      centre,
      centre,
      innerRadius,
      startAngle + insertAngle,
      startAngle,
      true,
    );
    context.closePath();
    context.fill();
  }
}

/**
 * Build the top/bottom face texture for one chip: clay body, rim inserts,
 * ring grooves, recessed inlay, denomination value and casino monogram.
 */
export function createChipFaceTexture(
  theme: CasinoTheme,
  denomination: number,
  monogram: string,
): THREE.CanvasTexture {
  const size = CHIP_FACE_TEXTURE_SIZE;
  const { canvas, context } = createCanvas(size);
  const centre = size / 2;
  const outerRadius = centre - 2;

  const denominationStyle = getDenominationStyle(denomination);
  const mouldProfile = getMouldProfile(theme.materials.chipMould);

  context.clearRect(0, 0, size, size);

  context.fillStyle = denominationStyle.body;
  context.beginPath();
  context.arc(centre, centre, outerRadius, 0, Math.PI * 2);
  context.fill();

  drawEdgeInserts(
    context,
    centre,
    outerRadius,
    theme.materials.chipInserts,
    mouldProfile.insertWidthRatio,
    denominationStyle.insert,
  );

  if (mouldProfile.metallicRimBand) {
    context.strokeStyle = theme.palette.gold;
    context.lineWidth = outerRadius * 0.05;
    context.beginPath();
    context.arc(centre, centre, outerRadius * 0.8, 0, Math.PI * 2);
    context.stroke();
  }

  drawRingGrooves(
    context,
    centre,
    outerRadius,
    mouldProfile.ringGrooveCount,
    theme.palette.lineColor,
  );

  const inlayRadius = outerRadius * 0.62;
  context.fillStyle = theme.palette.accent;
  context.beginPath();
  context.arc(centre, centre, inlayRadius, 0, Math.PI * 2);
  context.fill();

  context.strokeStyle = theme.palette.gold;
  context.lineWidth = outerRadius * 0.022;
  context.beginPath();
  context.arc(centre, centre, inlayRadius * 0.94, 0, Math.PI * 2);
  context.stroke();

  context.fillStyle = theme.palette.gold;
  context.font = `600 ${Math.round(size * 0.075)}px Georgia, serif`;
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(monogram, centre, centre - inlayRadius * 0.42);

  context.fillStyle = theme.palette.lineColor;
  context.font = `700 ${Math.round(size * 0.14)}px Georgia, serif`;
  context.fillText(denominationStyle.label, centre, centre + inlayRadius * 0.12);

  context.fillStyle = theme.palette.gold;
  context.font = `500 ${Math.round(size * 0.045)}px Georgia, serif`;
  context.fillText(
    theme.tableRules.currency,
    centre,
    centre + inlayRadius * 0.58,
  );

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

/**
 * Build the rim texture. The rim wraps horizontally, so inserts are drawn as
 * evenly spaced vertical bands and teeth are added as fine darker lines.
 */
export function createChipRimTexture(
  theme: CasinoTheme,
  denomination: number,
): THREE.CanvasTexture {
  const width = 1024;
  const height = 64;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (context === null) {
    throw new Error("2D canvas context unavailable");
  }

  const denominationStyle = getDenominationStyle(denomination);
  const mouldProfile = getMouldProfile(theme.materials.chipMould);

  context.fillStyle = denominationStyle.body;
  context.fillRect(0, 0, width, height);

  const insertCount = theme.materials.chipInserts;
  const slotWidth = width / insertCount;
  const insertWidth = slotWidth * mouldProfile.insertWidthRatio;
  context.fillStyle = denominationStyle.insert;
  for (let insertIndex = 0; insertIndex < insertCount; insertIndex += 1) {
    const slotCentre = (insertIndex + 0.5) * slotWidth;
    context.fillRect(slotCentre - insertWidth / 2, 0, insertWidth, height);
  }

  if (mouldProfile.hasRimTeeth) {
    context.fillStyle = "rgba(0,0,0,0.32)";
    const toothCount = 180;
    const toothWidth = width / toothCount / 2;
    for (let toothIndex = 0; toothIndex < toothCount; toothIndex += 1) {
      context.fillRect((toothIndex * width) / toothCount, 0, toothWidth, height);
    }
  }

  if (mouldProfile.metallicRimBand) {
    context.fillStyle = theme.palette.gold;
    context.globalAlpha = 0.75;
    context.fillRect(0, height * 0.44, width, height * 0.12);
    context.globalAlpha = 1;
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  return texture;
}
