import js from '@eslint/js';
import security from 'eslint-plugin-security';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['**/node_modules/**', '**/dist/**', '**/coverage/**', 'poc/**', '.claude/**'] },
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  security.configs.recommended,
  {
    languageOptions: {
      parserOptions: { projectService: true },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-imports': 'error',
      // Falsos positivos con claves tipadas (uniones de literales). Las entradas externas se
      // validan con Zod antes de usarse como clave.
      'security/detect-object-injection': 'off',
      // `onChange={(e) => setX(e.target.value)}` es el patrón habitual de React.
      '@typescript-eslint/no-confusing-void-expression': ['error', { ignoreArrowShorthand: true }],
    },
  },
  {
    files: ['**/*.js'],
    ...tseslint.configs.disableTypeChecked,
  },
  {
    // packages/core no tiene I/O ni dependencias de plataforma (CLAUDE.md, Arquitectura).
    files: ['packages/core/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: ['node:*'], message: 'core no usa módulos de Node.' },
            {
              group: ['react-native', 'react-native/*', 'expo', 'expo-*'],
              message: 'core no depende de la plataforma móvil.',
            },
            { group: ['pg', 'kysely', '@campo/db'], message: 'core no accede a la base de datos.' },
          ],
        },
      ],
    },
  },
);
