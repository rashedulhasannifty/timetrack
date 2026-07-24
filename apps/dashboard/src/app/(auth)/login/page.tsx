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
  return (
    <main className="flex min-h-screen items-center justify-center p-8">
      <div className="w-full max-w-sm rounded-xl border border-neutral-200 bg-white p-6 shadow-sm">
        <h1 className="text-lg font-semibold">Sign in to TimeTrack</h1>
        {message ? (
          <p className="mt-2 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{message}</p>
        ) : null}
        <form className="mt-4 flex flex-col gap-3" action="/api/auth/login" method="post">
          <input
            name="email"
            type="email"
            placeholder="you@company.com"
            className="rounded-md border border-neutral-300 px-3 py-2 text-sm"
          />
          <input
            name="password"
            type="password"
            placeholder="Password"
            className="rounded-md border border-neutral-300 px-3 py-2 text-sm"
          />
          <button
            type="submit"
            className="rounded-md bg-neutral-900 px-3 py-2 text-sm font-medium text-white"
          >
            Sign in
          </button>
        </form>
        {ssoEnabled ? (
          <>
            <div className="my-4 flex items-center gap-3 text-xs text-neutral-400">
              <span className="h-px flex-1 bg-neutral-200" />
              or
              <span className="h-px flex-1 bg-neutral-200" />
            </div>
            <a
              href="/api/auth/sso/start"
              className="flex w-full items-center justify-center rounded-md border border-neutral-300 px-3 py-2 text-sm font-medium text-neutral-900 hover:bg-neutral-50"
            >
              Sign in with SSO
            </a>
          </>
        ) : null}
      </div>
    </main>
  );
}
