/**
 * Shared guard for a whole-row click that opens a drawer: the row also contains real
 * interactive descendants (a name button that opens the same drawer, a form, a popover
 * anchored to the row) and a click that started on one of those must not ALSO fire the row's
 * own handler.
 *
 * Duck-typed on `.closest` rather than `target instanceof Element` so this stays unit-testable
 * from a node-env vitest run with a plain mock object — a DOM `Element` global doesn't exist
 * there. Only `Element` nodes carry `.closest`; a `Text` node (also a valid `EventTarget`)
 * does not, so the duck-type check rejects it exactly like the `instanceof` check would.
 */
interface ClosestTarget {
  closest(selectors: string): unknown;
}

function hasClosest(target: EventTarget | null): target is EventTarget & ClosestTarget {
  return !!target && typeof (target as Partial<ClosestTarget>).closest === 'function';
}

/** Interactive elements a row-click guard must not fire through. */
const INTERACTIVE_SELECTOR = 'a,button,input,select,textarea,form,label,[role="dialog"]';

/** True when a row click started on an interactive descendant (or the target itself). */
export function startedOnInteractive(target: EventTarget | null): boolean {
  return hasClosest(target) && !!target.closest(INTERACTIVE_SELECTOR);
}
