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
  computeSeatPlacements,
  TABLE_SIZE,
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
 * The felt UV covers the table bounding box, so the texture origin is the
 * bottom-left of that box. Table Z grows towards the guest, and texture Y grows
 * downwards, hence the flip.
 */
function toTexturePixels(
  draw: DrawContext,
  x: number,
  z: number,
): { pixelX: number; pixelY: number } {
  return {
    pixelX: draw.width / 2 + x * draw.pixelsPerMetre,
    pixelY: draw.height / 2 - z * draw.pixelsPerMetre,
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

/**
 * One seat's printed block: three stacked betting boxes plus two pair circles
 * and the seat number, all rotated to square up with the guest.
 */
function drawSeatBlock(
  draw: DrawContext,
  theme: CasinoTheme,
  seatLabel: number,
  seatX: number,
  seatZ: number,
  facingRadians: number,
): void {
  const { context, pixelsPerMetre } = draw;
  const { pixelX, pixelY } = toTexturePixels(draw, seatX, seatZ);

  // Box sizes in metres, taken from the printed proportions on the SVG sheets.
  const boxWidth = 0.19 * pixelsPerMetre;
  const boxHeight = 0.052 * pixelsPerMetre;
  const boxGap = 0.009 * pixelsPerMetre;

  context.save();
  context.translate(pixelX, pixelY);
  // Texture Y is flipped relative to table Z, so the facing angle flips too.
  context.rotate(-facingRadians);

  context.textAlign = "center";
  context.textBaseline = "middle";

  const boxes: ReadonlyArray<{
    label: string;
    sublabel: string;
    fill: string;
    stroke: string;
  }> = [
    {
      label: "閒 PLAYER",
      sublabel: "1 : 1",
      fill: "rgba(0,0,0,0.14)",
      stroke: theme.palette.lineColor,
    },
    {
      label: "莊 BANKER",
      sublabel: theme.tableRules.commission ? "1 : 1 (−5%)" : "1 : 1",
      fill: "rgba(0,0,0,0.24)",
      stroke: theme.palette.gold,
    },
    {
      label: "和 TIE",
      sublabel: theme.tableRules.tiePayout,
      fill: "rgba(0,0,0,0.16)",
      stroke: theme.palette.tieBand,
    },
  ];

  // PLAYER nearest the guest means the largest positive local Y in texture space.
  boxes.forEach((box, boxIndex) => {
    const boxTop = (1 - boxIndex) * (boxHeight + boxGap) - boxHeight / 2;

    context.fillStyle = box.fill;
    fillRoundedRect(context, -boxWidth / 2, boxTop, boxWidth, boxHeight, boxHeight * 0.16);

    context.strokeStyle = box.stroke;
    context.lineWidth = Math.max(1.6, pixelsPerMetre * 0.0022);
    strokeRoundedRect(context, -boxWidth / 2, boxTop, boxWidth, boxHeight, boxHeight * 0.16);

    context.fillStyle = box.stroke;
    context.font = `600 ${Math.round(boxHeight * 0.4)}px 'Microsoft JhengHei', Georgia, serif`;
    context.fillText(box.label, 0, boxTop + boxHeight * 0.36);

    context.globalAlpha = 0.72;
    context.font = `500 ${Math.round(boxHeight * 0.26)}px Georgia, serif`;
    context.fillText(box.sublabel, 0, boxTop + boxHeight * 0.74);
    context.globalAlpha = 1;
  });

  // Pair side bets: two small circles flanking the block, nearest the guest.
  const pairRadius = boxHeight * 0.34;
  const pairY = 1.6 * (boxHeight + boxGap);
  const pairOffsetX = boxWidth * 0.3;
  const pairs: ReadonlyArray<{ label: string; colour: string; offsetX: number }> = [
    { label: "閒對", colour: theme.palette.lineColor, offsetX: -pairOffsetX },
    { label: "莊對", colour: theme.palette.gold, offsetX: pairOffsetX },
  ];

  for (const pair of pairs) {
    context.beginPath();
    context.arc(pair.offsetX, pairY, pairRadius, 0, Math.PI * 2);
    context.fillStyle = "rgba(0,0,0,0.18)";
    context.fill();
    context.strokeStyle = pair.colour;
    context.lineWidth = Math.max(1.4, pixelsPerMetre * 0.0018);
    context.stroke();

    context.fillStyle = pair.colour;
    context.font = `600 ${Math.round(pairRadius * 0.62)}px 'Microsoft JhengHei', sans-serif`;
    context.fillText(pair.label, pair.offsetX, pairY - pairRadius * 0.12);
    context.globalAlpha = 0.7;
    context.font = `500 ${Math.round(pairRadius * 0.42)}px Georgia, serif`;
    context.fillText("11:1", pair.offsetX, pairY + pairRadius * 0.45);
    context.globalAlpha = 1;
  }

  // Seat number printed on the felt edge, outside the boxes.
  context.fillStyle = theme.palette.gold;
  context.font = `700 ${Math.round(boxHeight * 0.72)}px Georgia, serif`;
  context.fillText(String(seatLabel), 0, -2.05 * (boxHeight + boxGap));

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

  const canvas = document.createElement("canvas");
  canvas.width = LAYOUT_TEXTURE_WIDTH;
  canvas.height = Math.round(
    (LAYOUT_TEXTURE_WIDTH * TABLE_SIZE.depth) / TABLE_SIZE.width,
  );
  const context = canvas.getContext("2d");
  if (context === null) {
    throw new Error("2D canvas context unavailable");
  }

  const draw: DrawContext = {
    context,
    width: canvas.width,
    height: canvas.height,
    pixelsPerMetre: canvas.width / TABLE_SIZE.width,
  };

  drawFeltBase(draw, theme);

  const seatPlacements = computeSeatPlacements(variant);
  for (const seat of seatPlacements) {
    drawSeatBlock(draw, theme, seat.label, seat.x, seat.z, seat.facingRadians);
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
