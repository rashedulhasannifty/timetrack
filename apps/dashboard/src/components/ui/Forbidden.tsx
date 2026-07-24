/**
 * The symmetric-transparency 403 state (design-prompt §1): a non-admin who lands on an admin
 * page sees a calm, plain explanation — never a stack trace or a raw "api 403". Rendered by
 * admin pages when the session role isn't ADMIN.
 */
export function Forbidden() {
  return (
    <div className="bg-surface-raised border-separator max-w-md rounded-lg border p-6 shadow-e1">
      <h1 className="text-text text-h2 font-display font-semibold">
        You can only see your own data
      </h1>
      <p className="text-text-secondary text-body mt-2">
        This page is available to administrators. If you need access, ask your admin.
      </p>
    </div>
  );
}
