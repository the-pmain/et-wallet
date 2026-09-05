import js from '@eslint/js'
import prettierConfig from 'eslint-config-prettier'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import globals from 'globals'
import tseslint from 'typescript-eslint'

/**
 * Architectural boundary rules.
 *
 * Layers follow the dependency direction: shared <- core <- features <- pages <- app.
 * Importing "up" that chain is forbidden — otherwise the layers stop being
 * layers, cycles appear, and the `core` module (where keys live) cannot be
 * tested in isolation or moved into an extension background script.
 *
 * The rules below are a machine check, not advice. A violation is a build error.
 */
const LAYER_BOUNDARIES = [
  {
    /* core is the domain kernel. It knows nothing of React, UI, or features.
       That is a hard requirement for moving the kernel into an MV3 service
       worker, where DOM and React are unavailable. */
    files: ['src/core/**/*.ts'],
    patterns: [
      { group: ['@/app', '@/app/*'], message: 'core cannot depend on the app layer.' },
      { group: ['@/pages', '@/pages/*'], message: 'core cannot depend on the pages layer.' },
      {
        group: ['@/features', '@/features/*'],
        message: 'core cannot depend on the features layer.',
      },
      {
        group: ['@/shared/ui', '@/shared/ui/*'],
        message: 'core cannot depend on UI components.',
      },
      {
        group: ['react', 'react-dom', 'react/*', 'react-dom/*'],
        message: 'core must run without React.',
      },
    ],
  },
  {
    /* shared is the lowest layer. It knows about nobody. */
    files: ['src/shared/**/*.{ts,tsx}'],
    patterns: [
      { group: ['@/app', '@/app/*'], message: 'shared cannot depend on the app layer.' },
      { group: ['@/pages', '@/pages/*'], message: 'shared cannot depend on the pages layer.' },
      {
        group: ['@/features', '@/features/*'],
        message: 'shared cannot depend on the features layer.',
      },
      { group: ['@/core', '@/core/*'], message: 'shared cannot depend on the core layer.' },
    ],
  },
  {
    /* features are vertical slices. They know nothing of pages or app composition. */
    files: ['src/features/**/*.{ts,tsx}'],
    patterns: [
      { group: ['@/app', '@/app/*'], message: 'features cannot depend on the app layer.' },
      { group: ['@/pages', '@/pages/*'], message: 'features cannot depend on the pages layer.' },
    ],
  },
  {
    /* pages compose features. They know nothing of the app layer. */
    files: ['src/pages/**/*.{ts,tsx}'],
    patterns: [{ group: ['@/app', '@/app/*'], message: 'pages cannot depend on the app layer.' }],
  },
]

/**
 * Storage APIs forbidden for direct use.
 *
 * localStorage and sessionStorage are synchronous, readable from any
 * script on the page without limit, and do not support binary data.
 * Any XSS reads them in one string. For a wallet that is unacceptable:
 * durable storage is IndexedDB only, through `core/storage`, always
 * encrypted.
 *
 * document.cookie is forbidden for the same reason, plus leakage via
 * requests.
 */
const FORBIDDEN_STORAGE_GLOBALS = [
  {
    name: 'localStorage',
    message:
      'Direct localStorage access is forbidden. Use core/storage (IndexedDB + encryption).',
  },
  {
    name: 'sessionStorage',
    message:
      'Direct sessionStorage access is forbidden. Use core/storage (IndexedDB + encryption).',
  },
]

export default tseslint.config(
  {
    ignores: ['dist/**', 'coverage/**', 'node_modules/**', '.vite/**'],
  },

  js.configs.recommended,
  tseslint.configs.recommendedTypeChecked,

  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },

  /* Shared settings for wallet source (browser). */
  {
    files: ['src/**/*.{ts,tsx}', 'e2e/**/*.ts'],
    languageOptions: {
      ecmaVersion: 2023,
      globals: globals.browser,
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],

      /* An unsettled Promise in wallet code is a lost transaction
         or an unclosed decryption session. Error only, not a warning. */
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/return-await': ['error', 'always'],
      '@typescript-eslint/switch-exhaustiveness-check': 'error',

      /* Explicit import type is required by verbatimModuleSyntax. */
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],

      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],

      /* eval and its cousins are a direct path to running foreign code
         and a CSP violation in Manifest v3. */
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-new-func': 'error',
      '@typescript-eslint/no-implied-eval': 'error',

      /* Direct writes to innerHTML/outerHTML are a classic XSS vector. */
      'no-restricted-properties': [
        'error',
        {
          property: 'innerHTML',
          message: 'Assigning innerHTML is an XSS vector. Use text nodes or React.',
        },
        {
          property: 'outerHTML',
          message: 'Assigning outerHTML is an XSS vector. Use text nodes or React.',
        },
      ],

      'no-restricted-globals': ['error', ...FORBIDDEN_STORAGE_GLOBALS],

      /* Logs in a production wallet build can contain addresses, amounts,
         and fragments of sensitive data. Only warn and error are allowed. */
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'prefer-const': 'error',
      'no-var': 'error',
      'object-shorthand': 'error',
    },
  },

  ...LAYER_BOUNDARIES.map(({ files, patterns }) => ({
    files,
    rules: {
      'no-restricted-imports': ['error', { patterns }],
    },
  })),

  /* Node layer: Fastify. Not React, not DOM, not wallet layers. */
  {
    files: ['server/src/**/*.ts'],
    languageOptions: {
      ecmaVersion: 2023,
      globals: globals.node,
    },
    rules: {
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/return-await': ['error', 'always'],
      '@typescript-eslint/switch-exhaustiveness-check': 'error',
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-new-func': 'error',
      '@typescript-eslint/no-implied-eval': 'error',
      'no-console': 'error',
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'prefer-const': 'error',
      'no-var': 'error',
      'object-shorthand': 'error',
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'ethers',
              message: 'The Node layer does not sign transactions.',
            },
            {
              name: 'web3',
              message: 'The Node layer does not sign transactions.',
            },
            {
              name: 'viem',
              message: 'The Node layer does not sign transactions.',
            },
            {
              name: '@noble/curves',
              message: 'The Node layer does not derive keys.',
            },
            {
              name: '@scure/bip32',
              message: 'The Node layer does not derive keys.',
            },
            {
              name: '@scure/bip39',
              message: 'The Node layer does not derive keys.',
            },
            {
              name: 'bip39',
              message: 'The Node layer does not derive keys.',
            },
            {
              name: 'bip32',
              message: 'The Node layer does not derive keys.',
            },
          ],
        },
      ],
    },
  },

  {
    files: ['server/src/index.ts'],
    rules: {
      'no-console': 'off',
    },
  },

  /* Config files and helper scripts run in Node. */
  {
    files: ['*.config.{js,ts}', 'build/**/*.ts', 'scripts/**/*.{js,mjs,ts}'],
    languageOptions: {
      globals: globals.node,
    },
    rules: {
      /* A build script talks to the developer through the terminal:
         the console ban protects the production build, not the tools. */
      'no-console': 'off',
    },
  },

  /* Tests: mocks and assertions that production code cannot make. */
  {
    files: ['**/*.test.{ts,tsx}', 'src/test/**/*.ts', 'e2e/**/*.ts'],
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
    },
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unnecessary-type-assertion': 'off',
      'no-restricted-imports': 'off',
      'no-restricted-globals': 'off',
    },
  },

  /*
    The sign-in pair (`email` and `the_p`) lives in localStorage on
    purpose: it must be readable before the encrypted wallet store
    opens, otherwise there is nothing to replay automatic sign-in
    after a reload. The record holds no balance, id, or profile —
    only the fields of `POST /v1/users/auth`.
  */
  {
    files: ['src/features/onboarding/model/login-credentials.ts'],
    rules: {
      'no-restricted-globals': 'off',
    },
  },

  /*
    The admin-cabinet PIN lives in localStorage on purpose: moving
    inside `/admin` and reloading the page must not ask for the code
    again. The server checks the PIN on every request.
  */
  {
    files: ['src/features/admin/model/admin-pin.ts'],
    rules: {
      'no-restricted-globals': 'off',
    },
  },

  /* Files outside the TypeScript type system: the ESLint config and
     build scripts. Rules that need type information do not apply —
     these files have no TypeScript project to take it from. */
  {
    files: ['**/*.{js,mjs}'],
    ...tseslint.configs.disableTypeChecked,
    languageOptions: {
      globals: globals.node,
    },
  },

  /* Turn off rules that conflict with Prettier. Must come last. */
  prettierConfig,
)
