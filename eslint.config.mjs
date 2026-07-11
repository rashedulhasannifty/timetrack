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
        { type: 'app',        pattern: 'apps/*' },
        { type: 'package',    pattern: 'packages/*' },
        { type: 'contracts',  pattern: 'packages/contracts' },
      ],
    },
    rules: {
      // PRD 7.1.7 — import direction is one-way. apps -> packages, never the reverse.
      'boundaries/element-types': ['error', {
        default: 'disallow',
        rules: [
          { from: 'app',       allow: ['app', 'package', 'contracts'] },
          { from: 'contracts', allow: [] },
          { from: 'package',   allow: ['contracts'] },
        ],
      }],
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
      'no-restricted-imports': ['error', {
        paths: [{
          name: '@timetrack/db',
          message: 'Prisma belongs in *.repository.ts only. See CLAUDE.md §3.',
        }],
      }],
    },
  },
  { files: ['scripts/**/*.ts'], rules: { 'no-console': 'off' } },
  { ignores: ['**/dist/**', '**/.next/**', '**/node_modules/**', 'apps/client-macos/**'] },
);
