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
    ],
    semi: false,
    singleQuote: true,
    trailingComma: 'all',
  },
  lint: {
    ignorePatterns: ['.turbo/**', 'dist/**', '**/*.d.ts', 'node_modules/**', '.wrangler/**'],
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
