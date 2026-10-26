import { defineConfig, globalIgnores } from 'eslint/config'
import nextCoreWebVitals from 'eslint-config-next/core-web-vitals'
import nextTypescript from 'eslint-config-next/typescript'

const eslintConfig = defineConfig([
  nextCoreWebVitals,
  nextTypescript,
  globalIgnores([
    '.next/**',
    'node_modules/**',
    'out/**',
    'next-env.d.ts',
    'playwright-report/**',
    'test-results/**'
  ]),
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }]
    }
  }
])

export default eslintConfig
