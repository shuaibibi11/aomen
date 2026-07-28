/**
 * Named camera views for the table scene.
 *
 * Three viewpoints matter for training: a guest sitting at a seat, the dealer
 * standing at the flat edge, and an overhead view a trainer uses to explain
 * layout. Positions are derived from the table geometry rather than hand-tuned
 * so they stay correct if the table size changes.
 */
import * as THREE from "three";
import { millimetresToMetres } from "./dimensions.js";
import { computeSeatPlacements, TABLE_SIZE, type TableVariant } from "./table-layout.js";

export type TableViewId = "guest" | "dealer" | "overhead";

export interface TableView {
  readonly id: TableViewId;
  readonly label: string;
  readonly cameraPosition: THREE.Vector3;
  readonly target: THREE.Vector3;
}

/** Eye height of a seated guest above the floor. */
const SEATED_EYE_HEIGHT = millimetresToMetres(1180);
/** Eye height of a standing dealer above the floor. */
const STANDING_EYE_HEIGHT = millimetresToMetres(1620);

/**
 * Build the three views for a table variant. The guest view uses the middle
 * seat so the whole layout is symmetric in frame.
 */
export function buildTableViews(variant: TableVariant): readonly TableView[] {
  const seatPlacements = computeSeatPlacements(variant);
  const middleSeat = seatPlacements[Math.floor(seatPlacements.length / 2)];
  const feltY = TABLE_SIZE.surfaceHeight + TABLE_SIZE.railRise;

  // Sit the guest a little behind their seat position, at the table edge.
  const guestZ = (middleSeat?.z ?? TABLE_SIZE.depth * 0.55) + millimetresToMetres(420);
  const guestX = middleSeat?.x ?? 0;

  return [
    {
      id: "guest",
      label: "玩家視角 Guest",
      cameraPosition: new THREE.Vector3(guestX, SEATED_EYE_HEIGHT, guestZ),
      target: new THREE.Vector3(0, feltY, -millimetresToMetres(120)),
    },
    {
      id: "dealer",
      label: "荷官視角 Dealer",
      cameraPosition: new THREE.Vector3(
        0,
        STANDING_EYE_HEIGHT,
        -TABLE_SIZE.depth * 0.62,
      ),
      target: new THREE.Vector3(0, feltY, TABLE_SIZE.depth * 0.36),
    },
    {
      id: "overhead",
      label: "上帝視角 Overhead",
      cameraPosition: new THREE.Vector3(
        0,
        feltY + TABLE_SIZE.width * 0.78,
        TABLE_SIZE.depth * 0.52,
      ),
      target: new THREE.Vector3(0, feltY, 0),
    },
  ];
}

export function getTableView(
  variant: TableVariant,
  viewId: TableViewId,
): TableView {
  const views = buildTableViews(variant);
  const match = views.find((view) => view.id === viewId);
  if (match === undefined) {
    throw new Error(`Unknown table view: ${viewId}`);
  }
  return match;
}
