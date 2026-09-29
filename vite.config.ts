import { defineConfig } from 'vite-plus'

export default defineConfig({
  fmt: {
    ignorePatterns: [
      '.cursor/**',
      '.turbo/**',
      'dist/**',
      '**/*.d.ts',
      'node_modules/**',
      '.wrangler/**',
      // Vendored byte-identical from the Brilliant project, plus the CSS the
      // token generator writes from them. Both are regenerated, not edited.
      'packages/web/design/**',
      'packages/web/src/tokens.css',
    ],
    semi: false,
    singleQuote: true,
    trailingComma: 'all',
  },
  lint: {
    ignorePatterns: [
      '.cursor/**',
      '.turbo/**',
      'dist/**',
      '**/*.d.ts',
      'node_modules/**',
      '.wrangler/**',
      'packages/web/design/**',
      'packages/web/src/tokens.css',
    ],
    jsPlugins: [
      {
        name: 'foldkit',
        specifier: '@foldkit/oxlint-plugin',
      },
    ],
    options: {
      typeAware: true,
      typeCheck: true,
    },
    plugins: ['typescript'],
    rules: {
      'no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
          destructuredArrayIgnorePattern: '^_',
          varsIgnorePattern: '^_',
        },
      ],
      'typescript/consistent-type-assertions': ['error', { assertionStyle: 'never' }],
      'typescript/no-explicit-any': 'error',
    },
  },
})
