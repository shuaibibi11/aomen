/**
 * Canvas-drawn textures for high-denomination plaques and membership cards.
 */
import * as THREE from "three";
import type { CasinoTheme } from "../specs/casino-theme.js";
import {
  MEMBER_CARD_DIMENSIONS_MM,
  PLAQUE_DIMENSIONS_MM,
} from "../specs/dimensions.js";
import { getPlaqueStyle, type MembershipTier } from "../specs/vip-assets.js";

function createCanvasForAspect(
  widthMm: number,
  heightMm: number,
  pixelWidth: number,
): { canvas: HTMLCanvasElement; context: CanvasRenderingContext2D } {
  const canvas = document.createElement("canvas");
  canvas.width = pixelWidth;
  canvas.height = Math.round((pixelWidth * heightMm) / widthMm);
  const context = canvas.getContext("2d");
  if (context === null) {
    throw new Error("2D canvas context unavailable");
  }
  return { canvas, context };
}

function strokeRoundedRect(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): void {
  context.beginPath();
  context.moveTo(x + radius, y);
  context.arcTo(x + width, y, x + width, y + height, radius);
  context.arcTo(x + width, y + height, x, y + height, radius);
  context.arcTo(x, y + height, x, y, radius);
  context.arcTo(x, y, x + width, y, radius);
  context.closePath();
  context.stroke();
}

/**
 * Plaque face: translucent slab colour, engraved inner panel, metal name plate
 * with the value, casino monogram and a serial-style reference line.
 */
export function createPlaqueFaceTexture(
  theme: CasinoTheme,
  denomination: number,
  monogram: string,
): THREE.CanvasTexture {
  const { canvas, context } = createCanvasForAspect(
    PLAQUE_DIMENSIONS_MM.width,
    PLAQUE_DIMENSIONS_MM.height,
    1024,
  );
  const width = canvas.width;
  const height = canvas.height;
  const style = getPlaqueStyle(denomination);
  const scale = width / PLAQUE_DIMENSIONS_MM.width;

  context.fillStyle = style.body;
  context.fillRect(0, 0, width, height);

  // Soft diagonal sheen so the acrylic does not read as flat paint.
  const sheen = context.createLinearGradient(0, 0, width, height);
  sheen.addColorStop(0, "rgba(255,255,255,0.22)");
  sheen.addColorStop(0.45, "rgba(255,255,255,0.02)");
  sheen.addColorStop(1, "rgba(0,0,0,0.18)");
  context.fillStyle = sheen;
  context.fillRect(0, 0, width, height);

  const panelInset = PLAQUE_DIMENSIONS_MM.panelInset * scale;
  context.strokeStyle = style.plate;
  context.lineWidth = width * 0.006;
  strokeRoundedRect(
    context,
    panelInset,
    panelInset,
    width - panelInset * 2,
    height - panelInset * 2,
    width * 0.02,
  );

  context.strokeStyle = theme.palette.gold;
  context.globalAlpha = 0.6;
  context.lineWidth = width * 0.0025;
  strokeRoundedRect(
    context,
    panelInset * 1.6,
    panelInset * 1.6,
    width - panelInset * 3.2,
    height - panelInset * 3.2,
    width * 0.016,
  );
  context.globalAlpha = 1;

  const plateWidth = PLAQUE_DIMENSIONS_MM.namePlateWidth * scale;
  const plateHeight = PLAQUE_DIMENSIONS_MM.namePlateHeight * scale;
  const plateX = (width - plateWidth) / 2;
  const plateY = height * 0.2;

  const plateGradient = context.createLinearGradient(plateX, plateY, plateX, plateY + plateHeight);
  plateGradient.addColorStop(0, style.plate);
  plateGradient.addColorStop(0.5, "#FFFFFF");
  plateGradient.addColorStop(1, style.plate);
  context.fillStyle = plateGradient;
  context.fillRect(plateX, plateY, plateWidth, plateHeight);

  context.fillStyle = "#22201A";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.font = `600 ${Math.round(plateHeight * 0.52)}px Georgia, serif`;
  context.fillText(theme.tableRules.currency, width / 2, plateY + plateHeight / 2);

  context.fillStyle = style.ink;
  context.font = `700 ${Math.round(width * 0.11)}px Georgia, serif`;
  context.fillText(style.label, width / 2, height * 0.56);

  context.font = `500 ${Math.round(width * 0.032)}px Georgia, serif`;
  context.globalAlpha = 0.75;
  context.fillText("TRAINING PLAQUE · NO CASH VALUE", width / 2, height * 0.72);
  context.globalAlpha = 1;

  context.fillStyle = style.plate;
  context.font = `600 ${Math.round(width * 0.055)}px Georgia, serif`;
  context.fillText(monogram, width / 2, height * 0.86);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

/**
 * Membership card front: tier band, programme name, tier name, a chip module
 * and a placeholder member number.
 */
export function createMemberCardFrontTexture(
  theme: CasinoTheme,
  programmeName: string,
  tier: MembershipTier,
  monogram: string,
): THREE.CanvasTexture {
  const { canvas, context } = createCanvasForAspect(
    MEMBER_CARD_DIMENSIONS_MM.width,
    MEMBER_CARD_DIMENSIONS_MM.height,
    1024,
  );
  const width = canvas.width;
  const height = canvas.height;

  context.fillStyle = tier.cardColour;
  context.fillRect(0, 0, width, height);

  if (tier.metallic) {
    const brushed = context.createLinearGradient(0, 0, width, 0);
    brushed.addColorStop(0, "rgba(255,255,255,0.16)");
    brushed.addColorStop(0.3, "rgba(255,255,255,0.03)");
    brushed.addColorStop(0.55, "rgba(255,255,255,0.2)");
    brushed.addColorStop(1, "rgba(0,0,0,0.16)");
    context.fillStyle = brushed;
    context.fillRect(0, 0, width, height);
  }

  // Diagonal accent sweep across the lower third.
  context.save();
  context.beginPath();
  context.moveTo(0, height * 0.72);
  context.lineTo(width, height * 0.5);
  context.lineTo(width, height);
  context.lineTo(0, height);
  context.closePath();
  context.fillStyle = tier.accentColour;
  context.globalAlpha = 0.16;
  context.fill();
  context.restore();

  context.fillStyle = tier.accentColour;
  context.textAlign = "left";
  context.textBaseline = "middle";
  context.font = `600 ${Math.round(width * 0.042)}px Georgia, serif`;
  context.fillText(programmeName.toUpperCase(), width * 0.07, height * 0.16);

  context.font = `700 ${Math.round(width * 0.085)}px Georgia, serif`;
  context.fillText(tier.name.toUpperCase(), width * 0.07, height * 0.34);

  // Contact chip module, positioned where a real card carries it.
  const chipWidth = width * 0.1;
  const chipHeight = chipWidth * 0.78;
  const chipX = width * 0.07;
  const chipY = height * 0.48;
  const chipGradient = context.createLinearGradient(chipX, chipY, chipX + chipWidth, chipY + chipHeight);
  chipGradient.addColorStop(0, "#D9C169");
  chipGradient.addColorStop(1, "#9A8034");
  context.fillStyle = chipGradient;
  context.fillRect(chipX, chipY, chipWidth, chipHeight);
  context.strokeStyle = "rgba(0,0,0,0.35)";
  context.lineWidth = width * 0.002;
  for (let lineIndex = 1; lineIndex < 4; lineIndex += 1) {
    const lineY = chipY + (chipHeight * lineIndex) / 4;
    context.beginPath();
    context.moveTo(chipX, lineY);
    context.lineTo(chipX + chipWidth, lineY);
    context.stroke();
  }

  context.fillStyle = tier.accentColour;
  context.globalAlpha = 0.9;
  context.font = `500 ${Math.round(width * 0.048)}px 'Courier New', monospace`;
  context.fillText("0000 0000 0000", width * 0.07, height * 0.79);

  context.globalAlpha = 0.6;
  context.font = `500 ${Math.round(width * 0.028)}px Georgia, serif`;
  context.fillText("TRAINING SIMULATION CARD", width * 0.07, height * 0.92);
  context.globalAlpha = 1;

  context.textAlign = "right";
  context.fillStyle = theme.palette.gold;
  context.font = `600 ${Math.round(width * 0.1)}px Georgia, serif`;
  context.fillText(monogram, width * 0.93, height * 0.28);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

/** Membership card back: magnetic stripe, signature panel and disclaimer. */
export function createMemberCardBackTexture(
  tier: MembershipTier,
  disclaimer: string,
): THREE.CanvasTexture {
  const { canvas, context } = createCanvasForAspect(
    MEMBER_CARD_DIMENSIONS_MM.width,
    MEMBER_CARD_DIMENSIONS_MM.height,
    1024,
  );
  const width = canvas.width;
  const height = canvas.height;

  context.fillStyle = tier.cardColour;
  context.fillRect(0, 0, width, height);

  context.fillStyle = "#0B0B0D";
  context.fillRect(0, height * 0.14, width, height * 0.22);

  context.fillStyle = "#EDEAE0";
  context.fillRect(width * 0.06, height * 0.46, width * 0.62, height * 0.16);

  context.fillStyle = "#5A5A5A";
  context.textAlign = "left";
  context.textBaseline = "middle";
  context.font = `italic ${Math.round(width * 0.03)}px Georgia, serif`;
  context.fillText("Authorised signature", width * 0.08, height * 0.54);

  context.fillStyle = tier.accentColour;
  context.globalAlpha = 0.72;
  context.font = `500 ${Math.round(width * 0.026)}px Georgia, serif`;
  context.fillText(disclaimer, width * 0.06, height * 0.76);
  context.fillText("非官方授權 · 僅供訓練使用", width * 0.06, height * 0.86);
  context.globalAlpha = 1;

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}
