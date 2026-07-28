/**
 * Verify that the printed felt layout lands where the geometry expects it.
 *
 * Why this runs in a real browser rather than in Vitest: the unit tests only
 * cover the coordinate maths in `table-layout.ts`, which is self-consistent by
 * construction. The part that was never verified is the four-step chain from a
 * world position to a texture pixel:
 *
 *   world (x, z)  →  felt UV  →  canvas pixel  →  what flipY actually samples
 *
 * A mistake anywhere in that chain (most likely the flipY assumption) would put
 * the whole layout front-to-back while every unit test stayed green. The only
 * way to check it is to ask the renderer: raycast down onto the felt at a known
 * world position, read the interpolated UV at the hit point, sample the texture
 * canvas at that UV, and see whether the pixel carries printed ink or bare felt.
 *
 * Usage: node tools/verify-felt-mapping.mjs [devServerUrl]
 * Exits non-zero if any probe fails, so it can gate a release.
 */
import { chromium } from "playwright";

const DEV_SERVER_URL = process.argv[2] ?? "http://localhost:5173/";

/**
 * Probes are chosen so that a front-to-back flip cannot pass:
 * the commission row sits on the dealer side, the seat blocks on the guest side.
 * If the mapping were inverted, each would sample the other's bare felt.
 */
const PROBE_SCRIPT = `
(async () => {
  const THREE = window.__tableDebug?.THREE;
  const scene = window.__tableDebug?.scene;
  if (!THREE || !scene) {
    return { error: "window.__tableDebug not exposed by the app" };
  }

  const felt = scene.getObjectByName("table-felt");
  if (!felt) {
    return { error: "table-felt mesh not found in scene" };
  }

  const layout = window.__tableDebug.layout;
  const texture = felt.material.map;
  if (!texture || !texture.image) {
    return { error: "felt material has no texture map" };
  }

  // Read the texture canvas back into an ImageData we can sample.
  const sourceCanvas = texture.image;
  const readCanvas = document.createElement("canvas");
  readCanvas.width = sourceCanvas.width;
  readCanvas.height = sourceCanvas.height;
  const readContext = readCanvas.getContext("2d");
  readContext.drawImage(sourceCanvas, 0, 0);
  const imageData = readContext.getImageData(
    0, 0, readCanvas.width, readCanvas.height,
  );

  const samplePixelAtUv = (u, v) => {
    // Three.js samples with flipY, so V grows upwards while canvas Y grows down.
    const pixelX = Math.round(u * (readCanvas.width - 1));
    const pixelY = Math.round((1 - v) * (readCanvas.height - 1));
    const offset = (pixelY * readCanvas.width + pixelX) * 4;
    return {
      pixelX,
      pixelY,
      r: imageData.data[offset],
      g: imageData.data[offset + 1],
      b: imageData.data[offset + 2],
    };
  };

  felt.updateMatrixWorld(true);
  const raycaster = new THREE.Raycaster();

  /** Drop a ray straight down onto the felt at a world (x, z). */
  const probeWorldPosition = (worldX, worldZ) => {
    raycaster.set(
      new THREE.Vector3(worldX, 5, worldZ),
      new THREE.Vector3(0, -1, 0),
    );
    const hits = raycaster.intersectObject(felt, false);
    if (hits.length === 0) {
      return { hit: false };
    }
    const hit = hits[0];
    if (!hit.uv) {
      return { hit: true, uv: null };
    }
    return {
      hit: true,
      uv: { u: hit.uv.x, v: hit.uv.y },
      pixel: samplePixelAtUv(hit.uv.x, hit.uv.y),
    };
  };

  const probes = [];

  // Bare felt reference: a point on the cloth away from any printing.
  const feltReference = probeWorldPosition(
    layout.FELT_INSET.halfWidth * 0.86,
    layout.FELT_DEALER_EDGE_Z * 0.55,
  );
  probes.push({ name: "bare-felt-reference", ...feltReference });

  // Each seat's PLAYER box centre must carry printed ink.
  const seats = layout.computeSeatPlacements("mass");
  for (const seat of seats) {
    const box = layout.computePlayerBoxPosition(seat);
    probes.push({
      name: "player-box-seat-" + seat.label,
      seatLabel: seat.label,
      worldX: box.x,
      worldZ: box.z,
      ...probeWorldPosition(box.x, box.z),
    });
  }

  // The commission row is on the dealer side; a front-to-back flip would miss it.
  probes.push({
    name: "commission-row",
    worldX: 0,
    worldZ: -0.17,
    ...probeWorldPosition(0, -0.17),
  });

  return {
    textureSize: { width: readCanvas.width, height: readCanvas.height },
    probes,
  };
})()
`;

/** Colour distance, used to tell printed ink from bare felt. */
function colourDistance(first, second) {
  return Math.sqrt(
    (first.r - second.r) ** 2
    + (first.g - second.g) ** 2
    + (first.b - second.b) ** 2,
  );
}

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

  const consoleErrors = [];
  page.on("pageerror", (error) => consoleErrors.push(error.message));

  await page.goto(DEV_SERVER_URL, { waitUntil: "networkidle" });

  // Switch to the mass table so the felt mesh exists.
  await page.getByRole("button", { name: /大眾廳牌桌/ }).click();
  await page.waitForTimeout(1200);

  const result = await page.evaluate(PROBE_SCRIPT);
  await browser.close();

  if (consoleErrors.length > 0) {
    console.error("Page errors:");
    for (const message of consoleErrors) {
      console.error("  " + message);
    }
  }

  if (result.error) {
    console.error("PROBE SETUP FAILED: " + result.error);
    process.exit(1);
  }

  console.log(
    `Texture ${result.textureSize.width}x${result.textureSize.height}`,
  );

  const reference = result.probes.find(
    (probe) => probe.name === "bare-felt-reference",
  );
  if (!reference?.pixel) {
    console.error("FAILED: could not sample a bare-felt reference pixel");
    process.exit(1);
  }
  console.log(
    `Bare felt reference: rgb(${reference.pixel.r},${reference.pixel.g},${reference.pixel.b})`,
  );

  // Ink has to differ from bare felt by more than the weave and vignette do.
  const INK_THRESHOLD = 18;
  let failureCount = 0;

  for (const probe of result.probes) {
    if (probe.name === "bare-felt-reference") {
      continue;
    }
    if (!probe.hit) {
      console.error(`FAIL ${probe.name}: ray missed the felt`);
      failureCount += 1;
      continue;
    }
    if (!probe.uv) {
      console.error(`FAIL ${probe.name}: hit carried no UV`);
      failureCount += 1;
      continue;
    }

    const distance = colourDistance(probe.pixel, reference.pixel);
    const hasInk = distance > INK_THRESHOLD;
    const status = hasInk ? "PASS" : "FAIL";
    if (!hasInk) {
      failureCount += 1;
    }
    console.log(
      `${status} ${probe.name}: uv(${probe.uv.u.toFixed(3)}, ${probe.uv.v.toFixed(3)}) `
      + `px(${probe.pixel.pixelX},${probe.pixel.pixelY}) `
      + `rgb(${probe.pixel.r},${probe.pixel.g},${probe.pixel.b}) `
      + `delta=${distance.toFixed(1)}`,
    );
  }

  if (failureCount > 0) {
    console.error(`\n${failureCount} probe(s) failed.`);
    process.exit(1);
  }
  console.log("\nAll probes found printed ink at the expected world positions.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
