import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/**', 'drizzle/**'] },
  ...tseslint.configs.recommended,
  {
    rules: {
      // Unused values are already errors in tsc (noUnusedLocals); keep the underscore escape hatch for destructuring.
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', destructuredArrayIgnorePattern: '^_' }],
    },
  },
  {
    // Tests read untyped JSON responses; `any` there is deliberate.
    files: ['**/*.test.ts'],
    rules: { '@typescript-eslint/no-explicit-any': 'off' },
  },
);
