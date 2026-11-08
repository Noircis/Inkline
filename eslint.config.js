// Configuration ESLint (format « flat config », ESLint 9).
// Lancer : npm run lint
import js from '@eslint/js';
import globals from 'globals';

export default [
  { ignores: ['docs/', 'node_modules/'] },
  js.configs.recommended,
  {
    files: ['js/**/*.js'],
    languageOptions: { ecmaVersion: 2022, sourceType: 'module', globals: globals.browser },
    rules: {
      'no-unused-vars': ['error', { args: 'after-used', argsIgnorePattern: '^_', caughtErrors: 'none' }],
      'no-empty': ['error', { allowEmptyCatch: true }],
      eqeqeq: ['error', 'smart'],
      'prefer-const': 'error',
      'no-var': 'error',
    },
  },
  { files: ['sw.js'], languageOptions: { sourceType: 'script', globals: globals.serviceworker } },
  {
    files: ['tests/**/*.js', 'scripts/**/*.mjs', 'eslint.config.js', 'playwright.config.js'],
    languageOptions: { sourceType: 'module', globals: globals.node },
  },
  {
    // Tests d'interface : du code Node qui fait exécuter du code dans la page.
    files: ['tests/e2e/**/*.js'],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },
];
