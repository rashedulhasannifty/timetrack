/**
 * Pure index arithmetic for a hand-rolled Tab trap, kept dependency-free and DOM-free so
 * vitest (node-env, no DOM) can exercise it directly. Drawer supplies the live list of
 * focusable elements inside the panel and whichever one currently has focus; this module
 * only decides which one Tab/Shift+Tab should move to next. The DOM wiring — querying
 * focusables, reading document.activeElement, calling .focus() — stays in Drawer.
 */

/**
 * Given the panel's focusable elements in DOM order and whichever one (if any) currently
 * has focus, return where Tab (`shiftKey` false) or Shift+Tab (`shiftKey` true) should send
 * focus next. Wraps at both ends, including a single-element list wrapping to itself.
 *
 * `current` being `null`, or not present in `focusables` (focus landed somewhere outside the
 * trap some other way), is treated as "nothing focused yet": Tab goes to the first item,
 * Shift+Tab to the last.
 *
 * Returns `null` only when `focusables` is empty — there is nothing to cycle to. The caller
 * must still prevent the browser's default Tab in that case (or focus would leave the panel
 * entirely); it should fall back to focusing the panel container itself.
 */
export function nextFocusTarget<T>(
  focusables: readonly T[],
  current: T | null,
  shiftKey: boolean,
): T | null {
  if (focusables.length === 0) return null;

  const currentIndex = current === null ? -1 : focusables.indexOf(current);
  if (currentIndex === -1) {
    const fallbackIndex = shiftKey ? focusables.length - 1 : 0;
    return focusables[fallbackIndex] ?? null;
  }

  const lastIndex = focusables.length - 1;
  const nextIndex = shiftKey
    ? currentIndex === 0
      ? lastIndex
      : currentIndex - 1
    : currentIndex === lastIndex
      ? 0
      : currentIndex + 1;
  return focusables[nextIndex] ?? null;
}
