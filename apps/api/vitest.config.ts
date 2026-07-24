import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    fileParallelism: false,
    setupFiles: ["./tests/setup-env.ts"],
    // Integração contra o Supabase remoto + argon2 (hash intencionalmente lento):
    // o teto padrão de 5s é apertado para fluxos que criam/removem usuários.
    testTimeout: 20000,
  },
});
