/**
 * Verify that clicking the felt actually places a bet in the engine.
 *
 * This is the only check that covers the whole path end to end:
 *
 *   screen pixel → raycast → world position → seat + BetKind
 *     → place_bet intent → engine decision → snapshot → rendered chips
 *
 * The unit tests cover each link in isolation, and they all pass even when the
 * chain is broken, because none of them involves a camera, a canvas or a real
 * mesh. A projection error, a stale felt reference after a rebuild, or a click
 * handler that never fires would all show up here and nowhere else.
 *
 * Usage: node tools/verify-click-to-bet.mjs [devServerUrl]
 * Exits non-zero on any failure, so it can gate a release.
 */
import { chromium } from "playwright";

const DEV_SERVER_URL = process.argv[2] ?? "http://localhost:5173/";

/**
 * Project a world position to screen pixels using the live camera, then report
 * the canvas rect so the caller can turn that into a real mouse click.
 *
 * Projection has to happen in the page: the camera matrices live there, and
 * recomputing them here would be testing our own arithmetic rather than the
 * renderer's.
 */
const PROJECT_SPOT_SCRIPT = `
(({ seatLabel, spotId }) => {
  const debug = window.__tableDebug;
  if (!debug?.scene) {
    return { error: "window.__tableDebug not exposed" };
  }
  const { THREE, scene, layout, camera, canvas } = debug;
  if (!camera || !canvas) {
    return { error: "debug hook does not expose the camera and canvas" };
  }

  const felt = scene.getObjectByName("table-felt");
  if (!felt) {
    return { error: "table-felt mesh not in scene" };
  }

  const seats = layout.computeSeatPlacements(debug.tableVariant ?? "mass");
  const seat = seats.find((candidate) => candidate.label === seatLabel);
  if (!seat) {
    return { error: "no seat " + seatLabel };
  }

  const spots = debug.betSpots ?? [];
  const spot = spots.find((candidate) => candidate.id === spotId);
  if (!spot) {
    return { error: "no spot " + spotId };
  }

  const local = layout.seatLocalToWorld(seat, spot.localX, spot.localZ);

  // Project the point at the felt's real height, not at y = 0.
  //
  // The felt sits ~0.79 m above the table origin. Projecting a spot at y = 0
  // and clicking that pixel makes the ray hit the felt somewhere else entirely,
  // because of parallax: with an angled camera the error is roughly one betting
  // box, which is exactly the discrepancy this check first reported.
  felt.updateMatrixWorld(true);
  const worldPoint = new THREE.Vector3(local.x, felt.position.y, local.z);
  if (felt.parent) {
    felt.parent.localToWorld(worldPoint);
  }

  const projected = worldPoint.clone().project(camera);
  const bounds = canvas.getBoundingClientRect();
  return {
    clientX: bounds.left + ((projected.x + 1) / 2) * bounds.width,
    clientY: bounds.top + ((1 - projected.y) / 2) * bounds.height,
    world: { x: worldPoint.x, y: worldPoint.y, z: worldPoint.z },
    inFrustum: projected.z > -1 && projected.z < 1,
  };
})
`;

/** Read the engine state the way the UI does. */
const READ_STATE_SCRIPT = `
(() => {
  const session = window.__tableDebug?.session;
  if (!session) {
    return { error: "no live session" };
  }
  const snapshot = session.getSnapshot();
  const guestSeat = session.getGuestSeat();
  return {
    phase: snapshot.phase,
    betCount: snapshot.bets.length,
    bets: snapshot.bets.map((bet) => ({
      seatId: bet.seatId,
      betKind: bet.betKind,
      amount: bet.amount,
    })),
    guestSeatLabel: guestSeat.label,
    guestStack: session.getStack(guestSeat.label),
    outcome: snapshot.outcome,
    playerCards: snapshot.hands.player.length,
    bankerCards: snapshot.hands.banker.length,
    chipMeshCount: countMeshes("engine-bet-chips"),
    cardMeshCount: countMeshes("engine-dealt-cards"),
  };

  function countMeshes(groupName) {
    const group = window.__tableDebug.scene.getObjectByName(groupName);
    if (!group) {
      return 0;
    }
    let count = 0;
    group.traverse((child) => {
      if (child.isMesh) {
        count += 1;
      }
    });
    return count;
  }
})()
`;

let failureCount = 0;

function check(description, condition, detail = "") {
  const status = condition ? "PASS" : "FAIL";
  if (!condition) {
    failureCount += 1;
  }
  console.log(`${status} ${description}${detail ? ": " + detail : ""}`);
}

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });

  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));

  await page.goto(DEV_SERVER_URL, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /大眾廳牌桌/ }).click();
  await page.waitForTimeout(1500);

  // Overhead view looks straight down, so a projected spot centre is not hidden
  // behind the rail or another prop.
  await page.getByRole("button", { name: /上帝視角/ }).click();
  await page.waitForTimeout(1200);

  const before = await page.evaluate(READ_STATE_SCRIPT);
  if (before.error) {
    console.error("SETUP FAILED: " + before.error);
    await browser.close();
    process.exit(1);
  }

  console.log(
    `Opening state: phase=${before.phase} bets=${before.betCount} stack=${before.guestStack}`,
  );
  check("table opens with betting available", before.phase === "round_betting");
  check("table opens with no bets placed", before.betCount === 0);
  check("guest seat is funded", before.guestStack > 0);

  // Click the guest seat's PLAYER box.
  const projection = await page.evaluate(
    `(${PROJECT_SPOT_SCRIPT})({ seatLabel: ${before.guestSeatLabel}, spotId: "player" })`,
  );
  if (projection.error) {
    console.error("PROJECTION FAILED: " + projection.error);
    await browser.close();
    process.exit(1);
  }
  check("spot projects inside the view frustum", projection.inFrustum === true);

  await page.mouse.click(projection.clientX, projection.clientY);
  await page.waitForTimeout(400);

  const afterClick = await page.evaluate(READ_STATE_SCRIPT);
  console.log(
    `After click: bets=${afterClick.betCount} stack=${afterClick.guestStack} chipMeshes=${afterClick.chipMeshCount}`,
  );

  check(
    "a click on the PLAYER box reaches the engine as a bet",
    afterClick.betCount === 1,
    `bets=${afterClick.betCount}`,
  );
  check(
    "the bet is recorded against the player spot",
    afterClick.bets[0]?.betKind === "player",
    afterClick.bets[0]?.betKind ?? "none",
  );
  check(
    "the stake is locked out of the seat's stack",
    afterClick.guestStack < before.guestStack,
    `${before.guestStack} → ${afterClick.guestStack}`,
  );
  check(
    "chips appear on the cloth for the accepted bet",
    afterClick.chipMeshCount > 0,
    `meshes=${afterClick.chipMeshCount}`,
  );

  // Deal the hand out and settle it.
  await page.getByRole("button", { name: /停止下注並發牌/ }).click();
  await page.waitForTimeout(800);

  const afterSettle = await page.evaluate(READ_STATE_SCRIPT);
  console.log(
    `After settle: phase=${afterSettle.phase} outcome=${afterSettle.outcome} `
    + `stack=${afterSettle.guestStack} `
    + `cards=${afterSettle.playerCards}+${afterSettle.bankerCards} `
    + `cardMeshes=${afterSettle.cardMeshCount}`,
  );
  check("the round settles", afterSettle.phase === "round_end");
  check(
    "the round produces a real outcome",
    ["player", "banker", "tie"].includes(afterSettle.outcome),
    String(afterSettle.outcome),
  );

  // The engine dealt cards; the cloth has to show them. A mesh count of zero
  // here is exactly the gap that existed before the hands were rendered: the
  // panel showed the totals while the table stayed empty.
  const dealtCardCount = afterSettle.playerCards + afterSettle.bankerCards;
  check(
    "the engine dealt at least the four opening cards",
    dealtCardCount >= 4,
    `${afterSettle.playerCards}+${afterSettle.bankerCards}`,
  );
  check(
    "every dealt card is rendered on the cloth",
    afterSettle.cardMeshCount >= dealtCardCount,
    `${afterSettle.cardMeshCount} meshes for ${dealtCardCount} cards`,
  );

  // A bet placed after betting closed must be refused by the engine.
  const rejectedProjection = await page.evaluate(
    `(${PROJECT_SPOT_SCRIPT})({ seatLabel: ${before.guestSeatLabel}, spotId: "banker" })`,
  );
  if (!rejectedProjection.error) {
    await page.mouse.click(
      rejectedProjection.clientX,
      rejectedProjection.clientY,
    );
    await page.waitForTimeout(300);
    const feedbackText = await page
      .locator("#bet-feedback")
      .textContent();
    check(
      "a bet after the round ended is rejected with a reason",
      (feedbackText ?? "").includes("拒絕"),
      (feedbackText ?? "").trim(),
    );
  }

  await browser.close();

  if (pageErrors.length > 0) {
    console.error("\nPage errors:");
    for (const message of pageErrors) {
      console.error("  " + message);
    }
    failureCount += pageErrors.length;
  }

  if (failureCount > 0) {
    console.error(`\n${failureCount} check(s) failed.`);
    process.exit(1);
  }
  console.log("\nClick-to-bet path verified end to end.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
