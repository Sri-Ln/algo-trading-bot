/** Whether this browser has been shown the product tour, so it opens by itself only once. */
export const TOUR_KEY = "tour";

/** True once the tour has been shown; false when it hasn't or storage is blocked. */
export function readTourSeen(storage: () => Storage = () => localStorage): boolean {
  try {
    return storage().getItem(TOUR_KEY) === "seen";
  } catch {
    return false;
  }
}

/** Remembers the tour was shown; a blocked store is ignored. */
export function markTourSeen(storage: () => Storage = () => localStorage): void {
  try {
    storage().setItem(TOUR_KEY, "seen");
  } catch {
    // keep going without persistence
  }
}
