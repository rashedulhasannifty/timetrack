export default function LoginPage() {
  return (
    <main className="flex min-h-screen items-center justify-center p-8">
      <div className="w-full max-w-sm rounded-xl border border-neutral-200 bg-white p-6 shadow-sm">
        <h1 className="text-lg font-semibold">Sign in to TimeTrack</h1>
        <p className="mt-1 text-sm text-neutral-500">
          Scaffold. Wire this form to <code>POST /auth/login</code>; the server sets a session
          cookie (PRD §7.6). The browser never holds a long-lived token.
        </p>
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
      </div>
    </main>
  );
}
