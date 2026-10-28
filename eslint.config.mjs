import { defineConfig,globalIgnores } from 'eslint/config';
import next from 'eslint-config-next/core-web-vitals';
import typescript from 'eslint-config-next/typescript';
export default defineConfig([...next,...typescript,globalIgnores(['out/**','dist/**','.next/**','node_modules/**','backups/**','test-results/**','playwright-report/**','.playwright-browsers/**']),{rules:{
 '@next/next/no-img-element':'off',
 // Existing local app uses intentionally subscribed IndexedDB effects; adopt compiler diagnostics separately.
 'react-hooks/set-state-in-effect':'off','react-hooks/refs':'off','react-hooks/purity':'off','react-hooks/preserve-manual-memoization':'off',
 '@typescript-eslint/no-unused-vars':['warn',{argsIgnorePattern:'^_',varsIgnorePattern:'^_'}]
}},{files:['tests/**'],rules:{'react-hooks/rules-of-hooks':'off'}}]);
