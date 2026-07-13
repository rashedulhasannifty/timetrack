/**
 * The symmetric-transparency 403 state (design-prompt §1): a non-admin who lands on an admin
 * page sees a calm, plain explanation — never a stack trace or a raw "api 403". Rendered by
 * admin pages when the session role isn't ADMIN.
 */
export function Forbidden() {
  return (
    <div className="max-w-md rounded-lg border border-neutral-200 bg-white p-6">
      <h1 className="text-lg font-semibold">You can only see your own data</h1>
      <p className="mt-2 text-sm text-neutral-500">
        This page is available to administrators. If you need access, ask your admin.
      </p>
    </div>
  );
}
