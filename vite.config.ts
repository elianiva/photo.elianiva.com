import { defineConfig } from 'vite-plus'

export default defineConfig({
  fmt: {
    ignorePatterns: [
      '.agents/**',
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
    ignorePatterns: [
      '.agents/**',
      '.turbo/**',
      'dist/**',
      '**/*.d.ts',
      'node_modules/**',
      '.wrangler/**',
    ],
    // Foldkit JS plugin (`@foldkit/oxlint-plugin`) removed for now: with
    // `jsPlugins` set, oxlint switches to fixed-size allocators (one ~4 GiB
    // reservation per thread) and panics at startup in
    // `crates/oxc_allocator/src/pool/fixed_size.rs` on machines with strict
    // memory overcommit accounting. Upstream: oxc-project/oxc#20331. Re-enable
    // once fixed: jsPlugins: [{ name: 'foldkit', specifier: '@foldkit/oxlint-plugin' }],
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
