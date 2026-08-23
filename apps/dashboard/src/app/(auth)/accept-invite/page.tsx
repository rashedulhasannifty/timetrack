import { BrandMark } from '../../../components/ui/BrandMark';
import { PasswordField } from '../../../components/ui/PasswordField';

/**
 * The landing page for the invite email's accept link. It lives in (auth), not (app),
 * because an invitee has no session yet — the (app) layout would bounce them to /login.
 *
 * The form POSTs to the BFF route, which calls the API and sets the session cookie; the
 * token never reaches a Client Component and is never stored.
 */
export default async function AcceptInvitePage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string; error?: string }>;
}) {
  const { token, error } = await searchParams;

  const inputClass =
    'bg-surface border-separator text-text placeholder:text-text-secondary focus:border-accent rounded-md border px-3 py-2.5 text-body outline-none transition-colors';

  const message =
    error === 'weak'
      ? 'Password must be at least 8 characters.'
      : error === 'mismatch'
        ? 'The two passwords do not match.'
        : error === 'invalid'
          ? 'This invitation link is invalid, expired, or has already been used. Ask your administrator to send a new one.'
          : null;

  // No token in the URL is a broken/truncated link — there is no form to show.
  const hasToken = typeof token === 'string' && token.length > 0;

  return (
    <main className="flex min-h-screen items-center justify-center p-8">
      <div className="bg-surface-raised border-separator w-full max-w-sm rounded-2xl border p-7 shadow-e2">
        <div className="mb-6 flex flex-col items-center gap-3 text-center">
          <BrandMark size={34} />
          <div>
            <h1 className="text-text font-display text-h2 font-semibold tracking-tight">
              Set your password
            </h1>
            <p className="text-text-secondary text-label mt-1">
              Choose a password to finish setting up your Nifty Timer account.
            </p>
          </div>
        </div>

        {message ? (
          <p className="bg-destructive/10 text-destructive text-label mb-4 rounded-md px-3 py-2">
            {message}
          </p>
        ) : null}

        {hasToken ? (
          <form className="flex flex-col gap-3" action="/api/auth/accept-invite" method="post">
            <input type="hidden" name="token" value={token} />
            <PasswordField
              name="password"
              autoComplete="new-password"
              minLength={8}
              required
              placeholder="New password (min 8 characters)"
              className={inputClass}
            />
            <PasswordField
              name="confirm"
              autoComplete="new-password"
              minLength={8}
              required
              placeholder="Confirm password"
              className={inputClass}
            />
            <button
              type="submit"
              className="bg-accent hover:bg-accent-hover text-body mt-1 rounded-md px-3 py-2.5 font-medium text-white transition-colors"
            >
              Set password and sign in
            </button>
          </form>
        ) : (
          <a
            href="/login"
            className="border-separator text-text hover:bg-surface text-body flex w-full items-center justify-center rounded-md border px-3 py-2.5 font-medium transition-colors"
          >
            Go to sign in
          </a>
        )}
      </div>
    </main>
  );
}
