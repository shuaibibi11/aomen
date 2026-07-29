/**
 * Printed felt layout texture for the baccarat table.
 *
 * Drawn once at high resolution and mapped across the whole felt footprint.
 * Seat blocks are placed on the same arc the 3D seat placements use, so a chip
 * dropped at a seat position lands inside its printed betting box.
 *
 * Layout order per seat, from the guest inwards: PLAYER, BANKER, TIE.
 */
import * as THREE from "three";
import type { CasinoTheme } from "../specs/casino-theme.js";
import {
  buildSeatBetSpots,
  computeSeatPlacements,
  FELT_INSET,
  OUTLINE_DEALER_DEPTH_RATIO,
  SEAT_NUMBER_LOCAL_Z,
  type BetSpotId,
  type BetSpotSpec,
  type SeatPlacement,
  type TableVariant,
} from "../specs/table-layout.js";

const LAYOUT_TEXTURE_WIDTH = 2048;

export interface FeltLayoutOptions {
  readonly theme: CasinoTheme;
  readonly variant: TableVariant;
}

interface DrawContext {
  readonly context: CanvasRenderingContext2D;
  readonly width: number;
  readonly height: number;
  /** Pixels per scene metre. */
  readonly pixelsPerMetre: number;
}

/**
 * Convert a table-space position in metres into texture pixels.
 *
 * This is the exact inverse of the UV mapping the felt geometry uses, and it
 * has to stay that way or the printed ink lands somewhere other than where a
 * raycast reads it. The felt UVs come from the felt outline bounding box, which
 * is NOT centred on the table: the flat dealer edge sits at +34% of the felt
 * depth and the guest apex reaches -66%, so the box is asymmetric in Z.
 *
 * Deriving the mapping (see buildFeltGeometry):
 *   - outline point (ox, oy) maps to world (ox, -oy) after rotateX(-π/2),
 *     so a world (x, z) came from outline (x, -z)
 *   - u = (x + feltHalfWidth) / feltWidth
 *   - v = (-z + dealerDepth) / feltDepth,  dealerDepth = 0.34 * feltDepth
 *   - flipY sampling puts V=0 at the canvas bottom, so pixelY = (1 - v) * height
 *
 * Substituting an isotropic pixels-per-metre (width = feltWidth * ppm,
 * height = feltDepth * ppm) collapses to the offsets below. An earlier version
 * centred on the whole table instead, which shifted every printed mark by
 * 0.16 * height in Z and pushed the outer seat boxes off their computed spots.
 */
function toTexturePixels(
  draw: DrawContext,
  x: number,
  z: number,
): { pixelX: number; pixelY: number } {
  const dealerDepth = OUTLINE_DEALER_DEPTH_RATIO * FELT_INSET.depth;
  return {
    pixelX: (x + FELT_INSET.halfWidth) * draw.pixelsPerMetre,
    pixelY: (z + dealerDepth) * draw.pixelsPerMetre,
  };
}

function drawFeltBase(draw: DrawContext, theme: CasinoTheme): void {
  const { context, width, height } = draw;

  context.fillStyle = theme.palette.feltMain;
  context.fillRect(0, 0, width, height);

  // Broad vignette so the centre of the table reads brighter under the pit light.
  const vignette = context.createRadialGradient(
    width / 2,
    height * 0.42,
    0,
    width / 2,
    height * 0.42,
    width * 0.62,
  );
  vignette.addColorStop(0, "rgba(255,255,255,0.09)");
  vignette.addColorStop(0.55, "rgba(0,0,0,0.02)");
  vignette.addColorStop(1, "rgba(0,0,0,0.3)");
  context.fillStyle = vignette;
  context.fillRect(0, 0, width, height);

  drawFeltWeave(draw, theme);
}

/** Fine woven texture so the felt does not read as flat paint. */
function drawFeltWeave(draw: DrawContext, theme: CasinoTheme): void {
  const { context, width, height } = draw;
  const weaveSpacing = Math.round(width / 340);

  context.strokeStyle = theme.palette.feltShadow;
  context.globalAlpha = 0.16;
  context.lineWidth = 1;

  for (let x = 0; x < width; x += weaveSpacing) {
    context.beginPath();
    context.moveTo(x, 0);
    context.lineTo(x, height);
    context.stroke();
  }
  for (let y = 0; y < height; y += weaveSpacing) {
    context.beginPath();
    context.moveTo(0, y);
    context.lineTo(width, y);
    context.stroke();
  }
  context.globalAlpha = 1;
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

function fillRoundedRect(
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
  context.fill();
}

/** Ink colour for each betting spot, so the three main bets stay tellable apart. */
function resolveSpotInk(theme: CasinoTheme, spotId: BetSpotId): string {
  switch (spotId) {
    case "banker":
    case "banker_pair":
      return theme.palette.gold;
    case "tie":
      return theme.palette.tieBand;
    default:
      return theme.palette.lineColor;
  }
}

/**
 * Draw one betting spot in the seat's local frame.
 *
 * The spot's own `localX` / `localZ` are used directly as canvas coordinates:
 * the caller has already translated to the seat and applied its rotation, and
 * the canvas frame is set up so canvas +X is world +X and canvas +Y is world +Z.
 */
function drawBetSpot(
  draw: DrawContext,
  theme: CasinoTheme,
  spot: BetSpotSpec,
): void {
  const { context, pixelsPerMetre } = draw;
  const inkColour = resolveSpotInk(theme, spot.id);
  const centreX = spot.localX * pixelsPerMetre;
  const centreY = spot.localZ * pixelsPerMetre;
  const strokeWidth = Math.max(1.8, pixelsPerMetre * 0.0024);

  if (spot.shape === "circle") {
    const radius = spot.radius * pixelsPerMetre;
    context.beginPath();
    context.arc(centreX, centreY, radius, 0, Math.PI * 2);
    context.fillStyle = "rgba(0,0,0,0.20)";
    context.fill();
    context.strokeStyle = inkColour;
    context.lineWidth = strokeWidth;
    context.stroke();

    context.fillStyle = inkColour;
    context.font = `600 ${Math.round(radius * 0.52)}px 'Microsoft JhengHei', sans-serif`;
    context.fillText(spot.label, centreX, centreY - radius * 0.18);
    context.globalAlpha = 0.75;
    context.font = `500 ${Math.round(radius * 0.36)}px Georgia, serif`;
    context.fillText(spot.sublabel, centreX, centreY + radius * 0.38);
    context.globalAlpha = 1;
    return;
  }

  const boxWidth = spot.width * pixelsPerMetre;
  const boxDepth = spot.depth * pixelsPerMetre;
  const boxLeft = centreX - boxWidth / 2;
  const boxTop = centreY - boxDepth / 2;
  const cornerRadius = boxDepth * 0.14;

  context.fillStyle = spot.id === "banker"
    ? "rgba(0,0,0,0.26)"
    : "rgba(0,0,0,0.15)";
  fillRoundedRect(context, boxLeft, boxTop, boxWidth, boxDepth, cornerRadius);

  context.strokeStyle = inkColour;
  context.lineWidth = strokeWidth;
  strokeRoundedRect(context, boxLeft, boxTop, boxWidth, boxDepth, cornerRadius);

  context.fillStyle = inkColour;
  context.font = `600 ${Math.round(boxDepth * 0.32)}px 'Microsoft JhengHei', Georgia, serif`;
  context.fillText(spot.label, centreX, centreY - boxDepth * 0.12);

  context.globalAlpha = 0.74;
  context.font = `500 ${Math.round(boxDepth * 0.22)}px Georgia, serif`;
  context.fillText(spot.sublabel, centreX, centreY + boxDepth * 0.24);
  context.globalAlpha = 1;
}

/**
 * One seat's printed block, drawn from the shared bet-spot specs.
 *
 * Drawing from the same `BetSpotSpec` list that `computeBetSpotPosition` reads is
 * what keeps a printed box and the chip that belongs in it aligned. An earlier
 * version kept its own hard-coded box sizes here and the two drifted apart: the
 * outer seats' printed boxes ended up beside their computed centres, which the
 * felt-mapping verifier caught as missing ink at four of the seven seats.
 */
function drawSeatBlock(
  draw: DrawContext,
  theme: CasinoTheme,
  seat: SeatPlacement,
  spots: readonly BetSpotSpec[],
): void {
  const { context, pixelsPerMetre } = draw;
  const { pixelX, pixelY } = toTexturePixels(draw, seat.x, seat.z);

  context.save();
  context.translate(pixelX, pixelY);
  // Canvas +Y matches world +Z, so the seat's world rotation applies directly.
  context.rotate(seat.facingRadians);
  context.textAlign = "center";
  context.textBaseline = "middle";

  for (const spot of spots) {
    drawBetSpot(draw, theme, spot);
  }

  // Seat number printed just inside the guest edge of the block.
  context.fillStyle = theme.palette.gold;
  context.font = `700 ${Math.round(0.03 * pixelsPerMetre)}px Georgia, serif`;
  context.fillText(
    String(seat.label),
    0,
    SEAT_NUMBER_LOCAL_Z * pixelsPerMetre,
  );

  context.restore();
}

/**
 * Commission boxes: one numbered cell per seat, printed on the dealer side in
 * front of the chip tray. Only drawn when the table charges commission.
 */
function drawCommissionRow(
  draw: DrawContext,
  theme: CasinoTheme,
  seatLabels: readonly number[],
): void {
  const { context, pixelsPerMetre } = draw;
  const cellWidth = 0.058 * pixelsPerMetre;
  const cellHeight = 0.04 * pixelsPerMetre;
  const rowZ = -0.17;
  const { pixelX, pixelY } = toTexturePixels(draw, 0, rowZ);

  context.save();
  context.translate(pixelX, pixelY);
  context.textAlign = "center";
  context.textBaseline = "middle";

  seatLabels.forEach((seatLabel, seatIndex) => {
    const cellX =
      (seatIndex - (seatLabels.length - 1) / 2) * cellWidth - cellWidth / 2;

    context.fillStyle = "rgba(0,0,0,0.24)";
    context.fillRect(cellX, -cellHeight / 2, cellWidth, cellHeight);
    context.strokeStyle = theme.palette.gold;
    context.lineWidth = Math.max(1.2, pixelsPerMetre * 0.0014);
    context.strokeRect(cellX, -cellHeight / 2, cellWidth, cellHeight);

    context.fillStyle = theme.palette.gold;
    context.font = `600 ${Math.round(cellHeight * 0.46)}px Georgia, serif`;
    context.fillText(String(seatLabel), cellX + cellWidth / 2, 0);
  });

  context.fillStyle = theme.palette.lineColor;
  context.globalAlpha = 0.6;
  context.font = `500 ${Math.round(cellHeight * 0.36)}px Georgia, serif`;
  context.fillText(
    "佣金格 COMMISSION",
    0,
    cellHeight * 0.95,
  );
  context.globalAlpha = 1;

  context.restore();
}

/** Centre medallion and the mandatory training disclaimer. */
function drawCentreMarkings(draw: DrawContext, theme: CasinoTheme): void {
  const { context, pixelsPerMetre } = draw;
  const { pixelX, pixelY } = toTexturePixels(draw, 0, 0.12);

  context.save();
  context.translate(pixelX, pixelY);
  context.textAlign = "center";
  context.textBaseline = "middle";

  const medallionRadius = 0.11 * pixelsPerMetre;
  context.strokeStyle = theme.palette.gold;
  context.globalAlpha = 0.5;
  context.lineWidth = Math.max(1.6, pixelsPerMetre * 0.002);
  context.beginPath();
  context.arc(0, 0, medallionRadius, 0, Math.PI * 2);
  context.stroke();
  context.beginPath();
  context.arc(0, 0, medallionRadius * 0.84, 0, Math.PI * 2);
  context.lineWidth = Math.max(1, pixelsPerMetre * 0.001);
  context.stroke();
  context.globalAlpha = 1;

  context.fillStyle = theme.palette.gold;
  context.font = `600 ${Math.round(medallionRadius * 0.34)}px Georgia, serif`;
  context.fillText("百家樂", 0, -medallionRadius * 0.22);
  context.globalAlpha = 0.8;
  context.font = `500 ${Math.round(medallionRadius * 0.2)}px Georgia, serif`;
  context.fillText("BACCARAT", 0, medallionRadius * 0.2);
  context.globalAlpha = 0.55;
  context.font = `500 ${Math.round(medallionRadius * 0.15)}px Georgia, serif`;
  context.fillText("仿真訓練 · 非官方授權", 0, medallionRadius * 0.55);
  context.fillText("訓練幣 · NO CASH VALUE", 0, medallionRadius * 0.74);
  context.globalAlpha = 1;

  context.restore();
}

/** Build the complete printed felt layout for one casino and hall type. */
export function createFeltLayoutTexture(
  options: FeltLayoutOptions,
): THREE.CanvasTexture {
  const { theme, variant } = options;

  // The canvas covers the felt bounding box, not the whole table, so the
  // pixels-per-metre here matches the felt UV mapping toTexturePixels inverts.
  const feltWidth = FELT_INSET.halfWidth * 2;
  const canvas = document.createElement("canvas");
  canvas.width = LAYOUT_TEXTURE_WIDTH;
  canvas.height = Math.round(
    (LAYOUT_TEXTURE_WIDTH * FELT_INSET.depth) / feltWidth,
  );
  const context = canvas.getContext("2d");
  if (context === null) {
    throw new Error("2D canvas context unavailable");
  }

  const draw: DrawContext = {
    context,
    width: canvas.width,
    height: canvas.height,
    pixelsPerMetre: canvas.width / feltWidth,
  };

  drawFeltBase(draw, theme);

  // One spot list for the whole table: the payout labels come from the rule
  // data, and every seat prints the same geometry.
  const betSpots = buildSeatBetSpots(
    theme.tableRules.tiePayout,
    theme.tableRules.commission,
  );

  const seatPlacements = computeSeatPlacements(variant);
  for (const seat of seatPlacements) {
    drawSeatBlock(draw, theme, seat, betSpots);
  }

  if (theme.tableRules.commission) {
    drawCommissionRow(
      draw,
      theme,
      seatPlacements.map((seat) => seat.label),
    );
  }

  drawCentreMarkings(draw, theme);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  return texture;
}
