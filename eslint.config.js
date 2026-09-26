import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';
import ui from './scripts/eslint-plugin-ui.mjs';
export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**', 'playwright-report/**', 'test-results/**', '.artifacts/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'error',
    },
  },
  {
    // UI gate: every screen is built from src/ui and the theme tokens (docs/ui-overhaul-plan.md §3.7).
    files: ['src/**/*.{ts,tsx}'],
    plugins: { ui },
    linterOptions: { reportUnusedDisableDirectives: 'error' },
    rules: {
      'ui/no-native-controls': 'error',
      'ui/kit-imports': 'error',
      'ui/theme-tokens': 'error',
      'ui/consistent-actions': 'error',
      'ui/require-disable-reason': 'error',
    },
  },
);
