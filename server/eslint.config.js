import js from '@eslint/js'
import globals from 'globals'
import tseslint from 'typescript-eslint'

/**
 * Правила сервиса.
 *
 * Повторяют строгость расширения там, где это осмысленно, и добавляют
 * запрет на зависимости, которых у справочного сервиса быть не может.
 */
export default tseslint.config(
  {
    ignores: ['dist/**', 'node_modules/**', 'coverage/**'],
  },

  js.configs.recommended,
  tseslint.configs.recommendedTypeChecked,

  {
    files: ['**/*.ts'],
    languageOptions: {
      ecmaVersion: 2023,
      globals: globals.node,
      parserOptions: {
        /* Файлы настройки инструментов лежат вне `src` и в проект
           TypeScript не входят: без явного разрешения служба типов
           отказывается их разбирать. */
        projectService: { allowDefaultProject: ['vitest.config.ts'] },
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      /* Незавершённый Promise в сервисе — потерянный ответ либо
         незакрытое соединение. */
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

      /* Журнал сервиса ведётся через Fastify: прямой вывод в консоль
         обходит и уровни, и сериализаторы, скрывающие лишнее.
         Исключение — точка входа, где журнала ещё нет. */
      'no-console': 'error',

      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'prefer-const': 'error',
      'no-var': 'error',
      'object-shorthand': 'error',
    },
  },

  /* Точка входа: сообщить о несостоявшемся запуске больше некуда. */
  {
    files: ['src/index.ts'],
    rules: {
      'no-console': 'off',
    },
  },

  {
    files: ['**/*.test.ts'],
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
    },
  },

  {
    files: ['**/*.js'],
    ...tseslint.configs.disableTypeChecked,
  },
)
