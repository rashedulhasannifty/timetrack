/**
 * The slot's match for `/reports` itself. On a SOFT navigation Next keeps a slot's previous
 * content when the new URL has no match in it — so without this, a range change on Reports (or
 * the sidebar link) with a person open would leave the drawer showing over it. Matching
 * `/reports` explicitly and rendering nothing closes it.
 */
export default function NoDrawer() {
  return null;
}
