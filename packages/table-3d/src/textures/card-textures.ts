/**
 * Canvas-drawn textures for playing cards.
 *
 * Card faces follow standard pip layouts so a trainee reads them the way they
 * read a real deck. Card backs carry the per-casino engraving.
 */
import * as THREE from "three";
import type { Rank, Suit } from "@mct/shared";
import type { CasinoTheme } from "../specs/casino-theme.js";
import { CARD_DIMENSIONS_MM } from "../specs/dimensions.js";

/** Texture resolution follows the real aspect ratio of a bridge-size card. */
const CARD_TEXTURE_WIDTH = 512;
const CARD_TEXTURE_HEIGHT = Math.round(
  (CARD_TEXTURE_WIDTH * CARD_DIMENSIONS_MM.height) / CARD_DIMENSIONS_MM.width,
);

/**
 * Card identity is the engine's own, not a parallel definition.
 *
 * These were previously declared locally with the same members. That worked only
 * by luck: the bet-spot ids were declared the same way and drifted (`player_pair`
 * versus `player-pair`), which broke every click on a pair circle. Aliasing the
 * engine types means a dealt card can be rendered directly, and any future
 * divergence is a compile error rather than a card that fails to draw.
 */
export type CardSuit = Suit;
export type CardRank = Rank;

const SUIT_GLYPHS: Record<CardSuit, string> = {
  spade: "\u2660",
  heart: "\u2665",
  diamond: "\u2666",
  club: "\u2663",
};

const RED_SUITS: ReadonlySet<CardSuit> = new Set<CardSuit>(["heart", "diamond"]);

/**
 * Pip positions as fractions of the inner card area. Standard decks mirror the
 * lower half, so only the upper half and centre column are listed and the
 * renderer reflects the rest.
 */
const PIP_LAYOUTS: Record<string, ReadonlyArray<readonly [number, number]>> = {
  A: [[0.5, 0.5]],
  "2": [[0.5, 0.14], [0.5, 0.86]],
  "3": [[0.5, 0.14], [0.5, 0.5], [0.5, 0.86]],
  "4": [[0.26, 0.14], [0.74, 0.14], [0.26, 0.86], [0.74, 0.86]],
  "5": [[0.26, 0.14], [0.74, 0.14], [0.5, 0.5], [0.26, 0.86], [0.74, 0.86]],
  "6": [
    [0.26, 0.14], [0.74, 0.14],
    [0.26, 0.5], [0.74, 0.5],
    [0.26, 0.86], [0.74, 0.86],
  ],
  "7": [
    [0.26, 0.14], [0.74, 0.14],
    [0.5, 0.32],
    [0.26, 0.5], [0.74, 0.5],
    [0.26, 0.86], [0.74, 0.86],
  ],
  "8": [
    [0.26, 0.14], [0.74, 0.14],
    [0.5, 0.32],
    [0.26, 0.5], [0.74, 0.5],
    [0.5, 0.68],
    [0.26, 0.86], [0.74, 0.86],
  ],
  "9": [
    [0.26, 0.13], [0.74, 0.13],
    [0.26, 0.37], [0.74, 0.37],
    [0.5, 0.5],
    [0.26, 0.63], [0.74, 0.63],
    [0.26, 0.87], [0.74, 0.87],
  ],
  "10": [
    [0.26, 0.13], [0.74, 0.13],
    [0.5, 0.26],
    [0.26, 0.37], [0.74, 0.37],
    [0.26, 0.63], [0.74, 0.63],
    [0.5, 0.74],
    [0.26, 0.87], [0.74, 0.87],
  ],
};

const FACE_RANKS: ReadonlySet<CardRank> = new Set<CardRank>(["J", "Q", "K"]);

function createCardCanvas(): {
  canvas: HTMLCanvasElement;
  context: CanvasRenderingContext2D;
} {
  const canvas = document.createElement("canvas");
  canvas.width = CARD_TEXTURE_WIDTH;
  canvas.height = CARD_TEXTURE_HEIGHT;
  const context = canvas.getContext("2d");
  if (context === null) {
    throw new Error("2D canvas context unavailable");
  }
  return { canvas, context };
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
 * One engraving tile per casino, drawn into a small repeating pattern so the
 * card back reads as printed guilloche rather than a flat colour.
 */
function drawEngravingTile(
  context: CanvasRenderingContext2D,
  engraving: string,
  tileSize: number,
  goldColour: string,
  accentColour: string,
): void {
  context.strokeStyle = goldColour;
  context.lineWidth = tileSize * 0.05;
  context.globalAlpha = 0.85;

  const half = tileSize / 2;

  switch (engraving) {
    case "arch":
      context.beginPath();
      context.moveTo(tileSize * 0.1, tileSize * 0.85);
      context.quadraticCurveTo(half, tileSize * 0.15, tileSize * 0.9, tileSize * 0.85);
      context.stroke();
      break;
    case "orbit":
      context.beginPath();
      context.arc(half, half, tileSize * 0.34, 0, Math.PI * 2);
      context.stroke();
      context.fillStyle = goldColour;
      context.beginPath();
      context.arc(half, half, tileSize * 0.08, 0, Math.PI * 2);
      context.fill();
      break;
    case "petal":
      context.beginPath();
      context.moveTo(half, tileSize * 0.12);
      context.quadraticCurveTo(tileSize * 0.86, half, half, tileSize * 0.88);
      context.quadraticCurveTo(tileSize * 0.14, half, half, tileSize * 0.12);
      context.stroke();
      break;
    case "lattice":
      context.strokeStyle = accentColour;
      context.beginPath();
      context.moveTo(half, tileSize * 0.08);
      context.lineTo(tileSize * 0.92, half);
      context.lineTo(half, tileSize * 0.92);
      context.lineTo(tileSize * 0.08, half);
      context.closePath();
      context.stroke();
      context.fillStyle = goldColour;
      context.globalAlpha = 0.5;
      context.beginPath();
      context.moveTo(half, tileSize * 0.3);
      context.lineTo(tileSize * 0.7, half);
      context.lineTo(half, tileSize * 0.7);
      context.lineTo(tileSize * 0.3, half);
      context.closePath();
      context.fill();
      break;
    case "feline":
      context.beginPath();
      context.moveTo(tileSize * 0.18, tileSize * 0.82);
      context.quadraticCurveTo(half, tileSize * 0.16, tileSize * 0.82, tileSize * 0.82);
      context.stroke();
      context.beginPath();
      context.moveTo(tileSize * 0.36, tileSize * 0.82);
      context.lineTo(tileSize * 0.36, tileSize * 0.58);
      context.moveTo(tileSize * 0.64, tileSize * 0.82);
      context.lineTo(tileSize * 0.64, tileSize * 0.58);
      context.stroke();
      break;
    default: // lotus
      context.beginPath();
      context.moveTo(half, tileSize * 0.88);
      context.quadraticCurveTo(tileSize * 0.12, half, half, tileSize * 0.12);
      context.quadraticCurveTo(tileSize * 0.88, half, half, tileSize * 0.88);
      context.stroke();
      break;
  }

  context.globalAlpha = 1;
}

/** Card back: white margin, coloured field, engraved pattern, centre medallion. */
export function createCardBackTexture(
  theme: CasinoTheme,
  monogram: string,
): THREE.CanvasTexture {
  const { canvas, context } = createCardCanvas();
  const width = canvas.width;
  const height = canvas.height;

  const borderInset =
    (CARD_DIMENSIONS_MM.backBorderInset / CARD_DIMENSIONS_MM.width) * width;
  const cornerRadius =
    (CARD_DIMENSIONS_MM.cornerRadius / CARD_DIMENSIONS_MM.width) * width;

  context.fillStyle = "#FCFBF6";
  fillRoundedRect(context, 0, 0, width, height, cornerRadius);

  context.save();
  context.beginPath();
  context.rect(borderInset, borderInset, width - borderInset * 2, height - borderInset * 2);
  context.clip();

  context.fillStyle = theme.palette.cardBack;
  context.fillRect(borderInset, borderInset, width - borderInset * 2, height - borderInset * 2);

  const tileSize = width * 0.13;
  for (let tileY = borderInset; tileY < height - borderInset; tileY += tileSize) {
    for (let tileX = borderInset; tileX < width - borderInset; tileX += tileSize) {
      context.save();
      context.translate(tileX, tileY);
      drawEngravingTile(
        context,
        theme.materials.cardEngrave,
        tileSize,
        theme.palette.gold,
        theme.palette.accent,
      );
      context.restore();
    }
  }
  context.restore();

  context.strokeStyle = theme.palette.gold;
  context.lineWidth = width * 0.008;
  context.strokeRect(
    borderInset * 1.7,
    borderInset * 1.7,
    width - borderInset * 3.4,
    height - borderInset * 3.4,
  );

  const medallionRadius = width * 0.17;
  context.fillStyle = theme.palette.cardBack;
  context.beginPath();
  context.arc(width / 2, height / 2, medallionRadius, 0, Math.PI * 2);
  context.fill();
  context.strokeStyle = theme.palette.gold;
  context.lineWidth = width * 0.01;
  context.stroke();

  context.fillStyle = theme.palette.gold;
  context.font = `600 ${Math.round(width * 0.17)}px Georgia, serif`;
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(monogram, width / 2, height / 2 + width * 0.008);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

function drawCornerIndex(
  context: CanvasRenderingContext2D,
  rank: CardRank,
  suitGlyph: string,
  colour: string,
  width: number,
): void {
  context.fillStyle = colour;
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.font = `700 ${Math.round(width * 0.13)}px Georgia, serif`;
  context.fillText(rank, width * 0.11, width * 0.12);
  context.font = `${Math.round(width * 0.1)}px serif`;
  context.fillText(suitGlyph, width * 0.11, width * 0.25);
}

/** Card face: corner indices at both ends plus the pip layout or a face panel. */
export function createCardFaceTexture(
  theme: CasinoTheme,
  rank: CardRank,
  suit: CardSuit,
): THREE.CanvasTexture {
  const { canvas, context } = createCardCanvas();
  const width = canvas.width;
  const height = canvas.height;
  const suitGlyph = SUIT_GLYPHS[suit];
  const inkColour = RED_SUITS.has(suit) ? "#C4141C" : "#141414";
  const cornerRadius =
    (CARD_DIMENSIONS_MM.cornerRadius / CARD_DIMENSIONS_MM.width) * width;

  context.fillStyle = "#FCFBF6";
  fillRoundedRect(context, 0, 0, width, height, cornerRadius);

  drawCornerIndex(context, rank, suitGlyph, inkColour, width);
  context.save();
  context.translate(width, height);
  context.rotate(Math.PI);
  drawCornerIndex(context, rank, suitGlyph, inkColour, width);
  context.restore();

  const innerLeft = width * 0.2;
  const innerTop = height * 0.11;
  const innerWidth = width * 0.6;
  const innerHeight = height * 0.78;

  if (FACE_RANKS.has(rank)) {
    context.strokeStyle = theme.palette.gold;
    context.lineWidth = width * 0.007;
    context.strokeRect(innerLeft, innerTop, innerWidth, innerHeight);
    context.fillStyle = inkColour;
    context.font = `700 ${Math.round(width * 0.3)}px Georgia, serif`;
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText(rank, width / 2, height / 2 - height * 0.05);
    context.font = `${Math.round(width * 0.18)}px serif`;
    context.fillText(suitGlyph, width / 2, height / 2 + height * 0.14);
  } else {
    const pipPositions = PIP_LAYOUTS[rank] ?? PIP_LAYOUTS.A;
    context.fillStyle = inkColour;
    context.textAlign = "center";
    context.textBaseline = "middle";
    const pipFontSize = rank === "A" ? width * 0.34 : width * 0.15;
    context.font = `${Math.round(pipFontSize)}px serif`;
    for (const [fractionX, fractionY] of pipPositions ?? []) {
      context.fillText(
        suitGlyph,
        innerLeft + innerWidth * fractionX,
        innerTop + innerHeight * fractionY,
      );
    }
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}
