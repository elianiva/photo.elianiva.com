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
      // Vendored byte-identical from the Brilliant project, plus the two
      // artefacts the token generator writes from them. All three are
      // regenerated, not edited.
      'packages/web/design/**',
      'packages/web/src/tokens.css',
      'packages/web/src/lib/design-tokens.ts',
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
      'packages/web/src/lib/design-tokens.ts',
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
