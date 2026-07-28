/**
 * Canvas textures for table furniture: the limit sign panel and the roadmap
 * monitor screen.
 */
import * as THREE from "three";
import type { CasinoTheme } from "../specs/casino-theme.js";
import {
  LIMIT_SIGN_DIMENSIONS_MM,
  ROADMAP_MONITOR_DIMENSIONS_MM,
} from "../specs/dimensions.js";
import {
  ROADMAP_ROW_COUNT,
  type RoadmapView,
} from "../specs/roadmap.js";

function createCanvas(
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

function formatCurrencyAmount(amount: number): string {
  return amount.toLocaleString("en-US");
}

/** Limit sign face: casino name, min and max bet, commission note. */
export function createLimitSignTexture(
  theme: CasinoTheme,
  minimumBet: number,
  maximumBet: number,
): THREE.CanvasTexture {
  const { canvas, context } = createCanvas(
    LIMIT_SIGN_DIMENSIONS_MM.width,
    LIMIT_SIGN_DIMENSIONS_MM.height,
    768,
  );
  const width = canvas.width;
  const height = canvas.height;

  context.fillStyle = theme.palette.feltShadow;
  context.fillRect(0, 0, width, height);

  const sheen = context.createLinearGradient(0, 0, 0, height);
  sheen.addColorStop(0, "rgba(255,255,255,0.13)");
  sheen.addColorStop(0.5, "rgba(255,255,255,0.02)");
  sheen.addColorStop(1, "rgba(0,0,0,0.25)");
  context.fillStyle = sheen;
  context.fillRect(0, 0, width, height);

  context.strokeStyle = theme.palette.gold;
  context.lineWidth = width * 0.012;
  context.strokeRect(
    width * 0.045,
    height * 0.07,
    width * 0.91,
    height * 0.86,
  );

  context.textAlign = "center";
  context.textBaseline = "middle";

  context.fillStyle = theme.palette.gold;
  context.font = `600 ${Math.round(width * 0.058)}px Georgia, serif`;
  context.fillText("百家樂 BACCARAT", width / 2, height * 0.2);

  context.fillStyle = "#F4EFE2";
  context.font = `700 ${Math.round(width * 0.072)}px Georgia, serif`;
  const currency = theme.tableRules.currency;
  context.fillText(
    `最低 ${currency} ${formatCurrencyAmount(minimumBet)}`,
    width / 2,
    height * 0.44,
  );
  context.fillText(
    `最高 ${currency} ${formatCurrencyAmount(maximumBet)}`,
    width / 2,
    height * 0.63,
  );

  context.fillStyle = theme.palette.accent;
  context.font = `500 ${Math.round(width * 0.042)}px Georgia, serif`;
  const commissionNote = theme.tableRules.commission
    ? "莊家佣金 5% · COMMISSION"
    : "免佣 NO COMMISSION";
  context.fillText(commissionNote, width / 2, height * 0.81);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

const BANKER_COLOUR = "#D2352F";
const PLAYER_COLOUR = "#2E62B8";
const TIE_COLOUR = "#1E9E58";

function outcomeColour(outcome: "banker" | "player" | "tie"): string {
  if (outcome === "banker") {
    return BANKER_COLOUR;
  }
  if (outcome === "player") {
    return PLAYER_COLOUR;
  }
  return TIE_COLOUR;
}

interface GridArea {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

function drawGrid(
  context: CanvasRenderingContext2D,
  area: GridArea,
  columnCount: number,
  rowCount: number,
  lineColour: string,
): number {
  const cellSize = Math.min(area.width / columnCount, area.height / rowCount);

  context.strokeStyle = lineColour;
  context.lineWidth = Math.max(1, cellSize * 0.03);
  context.globalAlpha = 0.4;

  for (let column = 0; column <= columnCount; column += 1) {
    const x = area.x + column * cellSize;
    context.beginPath();
    context.moveTo(x, area.y);
    context.lineTo(x, area.y + rowCount * cellSize);
    context.stroke();
  }
  for (let row = 0; row <= rowCount; row += 1) {
    const y = area.y + row * cellSize;
    context.beginPath();
    context.moveTo(area.x, y);
    context.lineTo(area.x + columnCount * cellSize, y);
    context.stroke();
  }
  context.globalAlpha = 1;

  return cellSize;
}

function drawSectionLabel(
  context: CanvasRenderingContext2D,
  label: string,
  x: number,
  y: number,
  fontSize: number,
): void {
  context.fillStyle = "#8C93A0";
  context.textAlign = "left";
  context.textBaseline = "bottom";
  context.font = `600 ${Math.round(fontSize)}px 'Segoe UI', sans-serif`;
  context.fillText(label, x, y);
}

/**
 * Roadmap screen: bead plate on the left, big road across the top right, and
 * the three derived roads stacked beneath it, matching a live Macau display.
 */
export function createRoadmapScreenTexture(
  roadmap: RoadmapView,
  theme: CasinoTheme,
): THREE.CanvasTexture {
  const { canvas, context } = createCanvas(
    ROADMAP_MONITOR_DIMENSIONS_MM.screenWidth,
    ROADMAP_MONITOR_DIMENSIONS_MM.screenHeight,
    1280,
  );
  const width = canvas.width;
  const height = canvas.height;

  context.fillStyle = "#0B0E14";
  context.fillRect(0, 0, width, height);

  const margin = width * 0.018;
  const labelSize = width * 0.017;

  // Bead plate occupies the left third.
  const beadArea: GridArea = {
    x: margin,
    y: margin + labelSize * 1.4,
    width: width * 0.3,
    height: height - margin * 2 - labelSize * 1.4,
  };
  drawSectionLabel(context, "珠盤路 BEAD PLATE", beadArea.x, beadArea.y - labelSize * 0.35, labelSize);
  const beadColumnCount = Math.max(
    Math.floor(beadArea.width / (beadArea.height / ROADMAP_ROW_COUNT)),
    1,
  );
  const beadCell = drawGrid(
    context,
    beadArea,
    beadColumnCount,
    ROADMAP_ROW_COUNT,
    "#2A313A",
  );

  const visibleBeadColumns = roadmap.beadPlate.slice(-beadColumnCount);
  visibleBeadColumns.forEach((column, columnIndex) => {
    column.forEach((cell, rowIndex) => {
      const centreX = beadArea.x + (columnIndex + 0.5) * beadCell;
      const centreY = beadArea.y + (rowIndex + 0.5) * beadCell;
      context.beginPath();
      context.arc(centreX, centreY, beadCell * 0.36, 0, Math.PI * 2);
      context.fillStyle = outcomeColour(cell.outcome);
      context.fill();

      const label = cell.outcome === "banker" ? "莊" : cell.outcome === "player" ? "閒" : "和";
      context.fillStyle = "#FFFFFF";
      context.textAlign = "center";
      context.textBaseline = "middle";
      context.font = `600 ${Math.round(beadCell * 0.4)}px 'Microsoft JhengHei', sans-serif`;
      context.fillText(label, centreX, centreY);

      if (cell.bankerPair) {
        context.beginPath();
        context.arc(centreX + beadCell * 0.3, centreY - beadCell * 0.3, beadCell * 0.1, 0, Math.PI * 2);
        context.fillStyle = BANKER_COLOUR;
        context.fill();
      }
      if (cell.playerPair) {
        context.beginPath();
        context.arc(centreX - beadCell * 0.3, centreY + beadCell * 0.3, beadCell * 0.1, 0, Math.PI * 2);
        context.fillStyle = PLAYER_COLOUR;
        context.fill();
      }
    });
  });

  // Big road across the top of the right area.
  const rightX = beadArea.x + beadArea.width + margin * 1.6;
  const rightWidth = width - rightX - margin;
  const bigRoadArea: GridArea = {
    x: rightX,
    y: beadArea.y,
    width: rightWidth,
    height: (height - margin * 2 - labelSize * 1.4) * 0.52,
  };
  drawSectionLabel(context, "大路 BIG ROAD", bigRoadArea.x, bigRoadArea.y - labelSize * 0.35, labelSize);
  const bigCellSize = bigRoadArea.height / ROADMAP_ROW_COUNT;
  const bigColumnCount = Math.max(Math.floor(bigRoadArea.width / bigCellSize), 1);
  drawGrid(context, bigRoadArea, bigColumnCount, ROADMAP_ROW_COUNT, "#2A313A");

  const visibleBigColumns = roadmap.bigRoad.slice(-bigColumnCount);
  visibleBigColumns.forEach((column, columnIndex) => {
    column.forEach((cell, rowIndex) => {
      if (rowIndex >= ROADMAP_ROW_COUNT) {
        return;
      }
      const centreX = bigRoadArea.x + (columnIndex + 0.5) * bigCellSize;
      const centreY = bigRoadArea.y + (rowIndex + 0.5) * bigCellSize;
      context.beginPath();
      context.arc(centreX, centreY, bigCellSize * 0.33, 0, Math.PI * 2);
      context.lineWidth = Math.max(1.5, bigCellSize * 0.12);
      context.strokeStyle = outcomeColour(cell.outcome);
      context.stroke();

      if (cell.tieCount > 0) {
        context.beginPath();
        context.moveTo(centreX - bigCellSize * 0.3, centreY + bigCellSize * 0.3);
        context.lineTo(centreX + bigCellSize * 0.3, centreY - bigCellSize * 0.3);
        context.strokeStyle = TIE_COLOUR;
        context.lineWidth = Math.max(1.2, bigCellSize * 0.08);
        context.stroke();
      }
    });
  });

  // Three derived roads stacked below the big road.
  const derivedTop = bigRoadArea.y + bigRoadArea.height + margin * 1.5;
  const derivedHeight = (height - derivedTop - margin) / 3;
  const derivedRoads: ReadonlyArray<{ label: string; marks: readonly string[] }> = [
    { label: "大眼仔 BIG EYE BOY", marks: roadmap.bigEyeBoy },
    { label: "小路 SMALL ROAD", marks: roadmap.smallRoad },
    { label: "曹仔 COCKROACH PIG", marks: roadmap.cockroachPig },
  ];

  derivedRoads.forEach((road, roadIndex) => {
    const rowTop = derivedTop + roadIndex * derivedHeight;
    const dotRadius = derivedHeight * 0.18;
    const dotPitch = dotRadius * 2.5;
    const maxDots = Math.max(Math.floor((rightWidth - labelSize * 8) / dotPitch), 1);

    context.fillStyle = "#767D89";
    context.textAlign = "left";
    context.textBaseline = "middle";
    context.font = `600 ${Math.round(labelSize * 0.85)}px 'Segoe UI', sans-serif`;
    context.fillText(road.label, rightX, rowTop + derivedHeight * 0.4);

    const dotsStartX = rightX + labelSize * 8;
    const visibleMarks = road.marks.slice(-maxDots);
    visibleMarks.forEach((mark, markIndex) => {
      const centreX = dotsStartX + (markIndex + 0.5) * dotPitch;
      const centreY = rowTop + derivedHeight * 0.4;
      context.beginPath();
      context.arc(centreX, centreY, dotRadius, 0, Math.PI * 2);
      if (mark === "red") {
        context.fillStyle = BANKER_COLOUR;
        context.fill();
      } else {
        context.strokeStyle = PLAYER_COLOUR;
        context.lineWidth = Math.max(1.4, dotRadius * 0.42);
        context.stroke();
      }
    });
  });

  // Running tally in the bottom left, the way a live board shows it.
  const tallyY = height - margin * 0.6;
  context.textAlign = "left";
  context.textBaseline = "bottom";
  context.font = `600 ${Math.round(labelSize * 0.95)}px 'Microsoft JhengHei', sans-serif`;
  context.fillStyle = BANKER_COLOUR;
  context.fillText(`莊 ${roadmap.bankerWins}`, beadArea.x, tallyY);
  context.fillStyle = PLAYER_COLOUR;
  context.fillText(`閒 ${roadmap.playerWins}`, beadArea.x + labelSize * 3.4, tallyY);
  context.fillStyle = TIE_COLOUR;
  context.fillText(`和 ${roadmap.ties}`, beadArea.x + labelSize * 6.8, tallyY);

  context.fillStyle = theme.palette.gold;
  context.globalAlpha = 0.5;
  context.textAlign = "right";
  context.font = `500 ${Math.round(labelSize * 0.8)}px 'Segoe UI', sans-serif`;
  context.fillText("訓練用 · TRAINING", width - margin, tallyY);
  context.globalAlpha = 1;

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}
