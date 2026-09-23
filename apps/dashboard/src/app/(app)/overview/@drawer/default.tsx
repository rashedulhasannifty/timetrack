/**
 * The drawer slot's resting state. Next requires a default.tsx for every parallel slot: on a
 * hard navigation it has no matching route for the slot and renders this instead of erroring.
 */
export default function Default() {
  return null;
}
