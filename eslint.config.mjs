// ESLint flat config. reachgate is plain Node.js ESM with no build step.
import js from '@eslint/js';
import globals from 'globals';

export default [
  { ignores: ['.reachgate/', 'node_modules/', 'assets/', 'docs/'] },
  js.configs.recommended,
  {
    files: ['**/*.{js,mjs}'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: { ...globals.node },
    },
  },
  {
    files: ['**/*.cjs'],
    languageOptions: { sourceType: 'commonjs', globals: { ...globals.node } },
  },
];
