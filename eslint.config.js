import js from '@eslint/js'
import prettierConfig from 'eslint-config-prettier'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import globals from 'globals'
import tseslint from 'typescript-eslint'

/**
 * Правила архитектурных границ.
 *
 * Слои выстроены по направлению зависимостей: shared <- core <- features <- pages <- app.
 * Импорт «вверх» по этой цепочке запрещён — иначе слои перестают быть слоями,
 * появляются циклы, а модуль `core` (где живут ключи) становится недоступен
 * для изолированного тестирования и переноса в background-скрипт расширения.
 *
 * Правила ниже — не рекомендация, а машинная проверка. Нарушение = ошибка сборки.
 */
const LAYER_BOUNDARIES = [
  {
    /* core — доменное ядро. Не знает ни о React, ни о UI, ни о фичах.
       Это обязательное условие для будущего переноса ядра в service worker MV3,
       где DOM и React недоступны в принципе. */
    files: ['src/core/**/*.ts'],
    patterns: [
      { group: ['@/app', '@/app/*'], message: 'core не может зависеть от слоя app.' },
      { group: ['@/pages', '@/pages/*'], message: 'core не может зависеть от слоя pages.' },
      {
        group: ['@/features', '@/features/*'],
        message: 'core не может зависеть от слоя features.',
      },
      {
        group: ['@/shared/ui', '@/shared/ui/*'],
        message: 'core не может зависеть от UI-компонентов.',
      },
      {
        group: ['react', 'react-dom', 'react/*', 'react-dom/*'],
        message: 'core должен работать без React.',
      },
    ],
  },
  {
    /* shared — самый нижний слой. Не знает ни о ком. */
    files: ['src/shared/**/*.{ts,tsx}'],
    patterns: [
      { group: ['@/app', '@/app/*'], message: 'shared не может зависеть от слоя app.' },
      { group: ['@/pages', '@/pages/*'], message: 'shared не может зависеть от слоя pages.' },
      {
        group: ['@/features', '@/features/*'],
        message: 'shared не может зависеть от слоя features.',
      },
      { group: ['@/core', '@/core/*'], message: 'shared не может зависеть от слоя core.' },
    ],
  },
  {
    /* features — вертикальные срезы. Не знают о страницах и о композиции приложения. */
    files: ['src/features/**/*.{ts,tsx}'],
    patterns: [
      { group: ['@/app', '@/app/*'], message: 'features не может зависеть от слоя app.' },
      { group: ['@/pages', '@/pages/*'], message: 'features не может зависеть от слоя pages.' },
    ],
  },
  {
    /* pages — композиция фич. Не знает о слое app. */
    files: ['src/pages/**/*.{ts,tsx}'],
    patterns: [{ group: ['@/app', '@/app/*'], message: 'pages не может зависеть от слоя app.' }],
  },
]

/**
 * Хранилища, запрещённые к прямому использованию.
 *
 * localStorage и sessionStorage — синхронные, неограниченно доступные из любого
 * скрипта на странице и не поддерживают бинарные данные. Любой XSS читает их
 * целиком одной строкой. Для кошелька это неприемлемо: постоянное хранилище —
 * только IndexedDB через слой `core/storage`, всегда в зашифрованном виде.
 *
 * document.cookie запрещён по той же причине плюс риск утечки через запросы.
 */
const FORBIDDEN_STORAGE_GLOBALS = [
  {
    name: 'localStorage',
    message:
      'Прямое обращение к localStorage запрещено. Используйте core/storage (IndexedDB + шифрование).',
  },
  {
    name: 'sessionStorage',
    message:
      'Прямое обращение к sessionStorage запрещено. Используйте core/storage (IndexedDB + шифрование).',
  },
]

export default tseslint.config(
  {
    ignores: ['dist/**', 'coverage/**', 'node_modules/**', '.vite/**'],
  },

  /* Базовые наборы правил. */
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

  /* Общие настройки для исходного кода кошелька (браузер). */
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

      /* --- Корректность --- */

      /* Незавершённый Promise в коде кошелька — это потерянная транзакция
         или незакрытая сессия дешифрования. Только ошибка, не предупреждение. */
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/return-await': ['error', 'always'],
      '@typescript-eslint/switch-exhaustiveness-check': 'error',

      /* Явный тип импорта — требование verbatimModuleSyntax. */
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],

      /* Неиспользуемые сущности допускаются только с префиксом `_`. */
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],

      /* --- Безопасность --- */

      /* eval и его аналоги — прямой путь к исполнению чужого кода
         и нарушение CSP в manifest v3. */
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-new-func': 'error',
      '@typescript-eslint/no-implied-eval': 'error',

      /* Запрет прямой записи в innerHTML/outerHTML — классический вектор XSS. */
      'no-restricted-properties': [
        'error',
        {
          property: 'innerHTML',
          message: 'Присваивание innerHTML — вектор XSS. Используйте текстовые узлы или React.',
        },
        {
          property: 'outerHTML',
          message: 'Присваивание outerHTML — вектор XSS. Используйте текстовые узлы или React.',
        },
      ],

      'no-restricted-globals': ['error', ...FORBIDDEN_STORAGE_GLOBALS],

      /* --- Чистота кода --- */

      /* Логи в production-сборке кошелька могут содержать адреса, суммы и
         фрагменты чувствительных данных. Разрешены только warn и error. */
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'prefer-const': 'error',
      'no-var': 'error',
      'object-shorthand': 'error',
    },
  },

  /* Архитектурные границы между слоями. */
  ...LAYER_BOUNDARIES.map(({ files, patterns }) => ({
    files,
    rules: {
      'no-restricted-imports': ['error', { patterns }],
    },
  })),

  /* Node-слой: Fastify. Не React, не DOM, не слои кошелька. */
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
              message: 'Node-слой не подписывает транзакции.',
            },
            {
              name: 'web3',
              message: 'Node-слой не подписывает транзакции.',
            },
            {
              name: 'viem',
              message: 'Node-слой не подписывает транзакции.',
            },
            {
              name: '@noble/curves',
              message: 'Node-слой не выводит ключи.',
            },
            {
              name: '@scure/bip32',
              message: 'Node-слой не выводит ключи.',
            },
            {
              name: '@scure/bip39',
              message: 'Node-слой не выводит ключи.',
            },
            {
              name: 'bip39',
              message: 'Node-слой не выводит ключи.',
            },
            {
              name: 'bip32',
              message: 'Node-слой не выводит ключи.',
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

  /* Конфигурационные файлы и служебные сценарии выполняются в Node. */
  {
    files: ['*.config.{js,ts}', 'build/**/*.ts', 'scripts/**/*.{js,mjs,ts}'],
    languageOptions: {
      globals: globals.node,
    },
    rules: {
      /* Сценарий сборки общается с разработчиком через вывод в терминал:
         запрет консоли защищает боевую сборку, а не инструменты. */
      'no-console': 'off',
    },
  },

  /* Тесты: допускаются моки и утверждения, невозможные в production-коде. */
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
    Пара входа (`email` и `the_p`) лежит в localStorage намеренно:
    её нужно прочитать до открытия зашифрованного хранилища кошелька,
    иначе автоматический вход после перезагрузки не из чего повторить.
    В запись не попадают баланс, id и профиль — только поля запроса
    `POST /v1/users/auth`.
  */
  {
    files: ['src/features/onboarding/model/login-credentials.ts'],
    rules: {
      'no-restricted-globals': 'off',
    },
  },

  /*
    PIN кабинета администратора лежит в localStorage намеренно:
    переход внутри `/admin` и перезагрузка страницы не должны
    снова спрашивать код. Сервер сверяет PIN на каждом запросе.
  */
  {
    files: ['src/features/admin/model/admin-pin.ts'],
    rules: {
      'no-restricted-globals': 'off',
    },
  },

  /* Файлы вне системы типов TypeScript: конфиг ESLint и сценарии сборки.
     Правила, требующие сведений о типах, для них неприменимы — проекта
     TypeScript, из которого их можно взять, у этих файлов нет. */
  {
    files: ['**/*.{js,mjs}'],
    ...tseslint.configs.disableTypeChecked,
    languageOptions: {
      globals: globals.node,
    },
  },

  /* Отключение правил, конфликтующих с Prettier. Должно идти последним. */
  prettierConfig,
)
