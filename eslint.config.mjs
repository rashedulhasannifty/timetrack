import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import boundaries from 'eslint-plugin-boundaries';

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    files: ['**/*.ts', '**/*.tsx'],
    // Type-aware rules (recommendedTypeChecked) need the parser to build type info.
    // projectService auto-discovers each file's nearest tsconfig across the workspace.
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: { boundaries },
    settings: {
      'boundaries/elements': [
        { type: 'app', pattern: 'apps/*' },
        { type: 'package', pattern: 'packages/*' },
        { type: 'contracts', pattern: 'packages/contracts' },
      ],
    },
    rules: {
      // PRD 7.1.7 — import direction is one-way. apps -> packages, never the reverse.
      // eslint-plugin-boundaries v7 API: rule is `dependencies` (was `element-types`),
      // the option is `policies` (was `rules`), and selectors are object-based (was strings).
      'boundaries/dependencies': [
        'error',
        {
          default: 'disallow',
          policies: [
            {
              from: { element: { type: 'app' } },
              allow: { to: { element: { type: ['app', 'package', 'contracts'] } } },
            },
            { from: { element: { type: 'contracts' } }, allow: [] },
            {
              from: { element: { type: 'package' } },
              allow: { to: { element: { type: ['contracts'] } } },
            },
          ],
        },
      ],
      // eslint 10 added `no-useless-assignment` to js.configs.recommended. It flags our
      // intentional `let x: T | null = null; try { x = await … } catch { … }` initializers
      // (the null is overwritten before any read) — a definite-assignment pattern TS needs,
      // not a dead store. Off, rather than churn working app code in a dependency bump.
      'no-useless-assignment': 'off',
      // Pino only. console.log is banned outside scripts/.
      'no-console': 'error',
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-explicit-any': 'error',
      // A leading underscore marks an intentionally-unused binding (e.g. a scaffold
      // handler that keeps its typed signature while the body is still a TODO).
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
    },
  },
  {
    // PRD 7.1.7 — Prisma is confined to repositories (api) and processors (worker).
    files: ['apps/api/src/**/*.ts'],
    ignores: ['apps/api/src/**/*.repository.ts', 'apps/api/src/infra/prisma/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@timetrack/db',
              message: 'Prisma belongs in *.repository.ts only. See CLAUDE.md §3.',
            },
          ],
        },
      ],
    },
  },
  { files: ['**/scripts/**/*.ts'], rules: { 'no-console': 'off' } },
  {
    // Asserting on a mocked method (`expect(repo.foo).toHaveBeenCalled()`) reads the
    // method unbound — a false positive for this rule in tests.
    files: ['**/*.spec.ts', '**/*.e2e-spec.ts'],
    rules: { '@typescript-eslint/unbound-method': 'off' },
  },
  { ignores: ['**/dist/**', '**/.next/**', '**/node_modules/**', 'apps/client-macos/**'] },
);
