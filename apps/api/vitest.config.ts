import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    fileParallelism: false,
    setupFiles: ["./tests/setup-env.ts"],
    // Integração contra o Supabase remoto + argon2 (hash intencionalmente lento):
    // os tetos padrão (5s teste / 10s hook) são apertados para fluxos que criam/removem
    // usuários (agora com auto-provisionamento de caixa) e montam tenants no beforeAll.
    testTimeout: 20000,
    hookTimeout: 30000,
  },
});
