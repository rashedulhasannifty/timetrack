import Link from 'next/link';
import { BrandMark } from '../../../components/ui/BrandMark';

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  // The API is the source of truth for whether SSO works; this flag only controls whether
  // the dashboard shows the button (a start against a disabled API 404s → /login?error=sso).
  const ssoEnabled = process.env.SSO_ENABLED === 'true';
  const message =
    error === 'sso'
      ? 'SSO sign-in failed. Please try again or use your email and password.'
      : error
        ? 'Invalid email or password.'
        : null;

  const inputClass =
    'bg-surface border-separator text-text placeholder:text-text-secondary focus:border-accent rounded-md border px-3 py-2.5 text-body outline-none transition-colors';

  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-8">
      <div className="bg-surface-raised border-separator w-full max-w-sm rounded-2xl border p-7 shadow-e2">
        <div className="mb-6 flex flex-col items-center gap-3 text-center">
          <Link href="/" aria-label="Nifty Timer home">
            <BrandMark size={34} />
          </Link>
          <div>
            <h1 className="text-text font-display text-h2 font-semibold tracking-tight">
              Sign in to Nifty Timer
            </h1>
            <p className="text-text-secondary text-label mt-1">Your workspace is waiting.</p>
          </div>
        </div>

        {message ? (
          <p className="bg-destructive/10 text-destructive text-label mb-4 rounded-md px-3 py-2">
            {message}
          </p>
        ) : null}

        <form className="flex flex-col gap-3" action="/api/auth/login" method="post">
          <input name="email" type="email" placeholder="you@company.com" className={inputClass} />
          <input name="password" type="password" placeholder="Password" className={inputClass} />
          <button
            type="submit"
            className="bg-accent hover:bg-accent-hover text-body mt-1 rounded-md px-3 py-2.5 font-medium text-white transition-colors"
          >
            Sign in
          </button>
        </form>

        {ssoEnabled ? (
          <>
            <div className="text-text-secondary text-caption my-4 flex items-center gap-3">
              <span className="bg-separator h-px flex-1" />
              or
              <span className="bg-separator h-px flex-1" />
            </div>
            <a
              href="/api/auth/sso/start"
              className="border-separator text-text hover:bg-surface text-body flex w-full items-center justify-center rounded-md border px-3 py-2.5 font-medium transition-colors"
            >
              Sign in with SSO
            </a>
          </>
        ) : null}
      </div>

      {/* The sign-in card is otherwise a dead end: someone who arrives here without an
          account — or before installing the client — has no route to the two public pages
          unless this row offers one. */}
      <nav className="text-text-secondary text-label mt-6 flex items-center gap-5">
        <Link href="/" className="hover:text-text transition-colors">
          Home
        </Link>
        <Link href="/install" className="hover:text-text transition-colors">
          Install guide
        </Link>
      </nav>
    </main>
  );
}
