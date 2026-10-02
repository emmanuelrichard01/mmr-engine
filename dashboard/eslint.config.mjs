// Flat ESLint config: Next.js core-web-vitals rules + typescript-eslint.
// eslint-config-next 15 ships eslintrc-style presets, bridged with FlatCompat.
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FlatCompat } from '@eslint/eslintrc';
import tseslint from 'typescript-eslint';

const compat = new FlatCompat({ baseDirectory: dirname(fileURLToPath(import.meta.url)) });

export default tseslint.config(
  { ignores: ['.next/**', 'node_modules/**', 'next-env.d.ts', 'out/**'] },
  ...compat.extends('next/core-web-vitals'),
  ...tseslint.configs.recommended,
);
