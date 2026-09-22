/**
 * The slot's match for `/overview` itself. On a SOFT navigation Next keeps a slot's previous
 * content when the new URL has no match in it — so without this, navigating back to Overview
 * (the sidebar link, the page's own range picker) with a person open would leave the drawer
 * showing over it. Matching `/overview` explicitly and rendering nothing closes it.
 */
export default function NoDrawer() {
  return null;
}
