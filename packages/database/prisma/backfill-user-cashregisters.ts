import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { config } from "dotenv";

config({ path: resolve(process.cwd(), "../../.env") });
const { prisma } = await import("../src/index.js");

// Backfill idempotente: garante que todo usuário ativo (não-plataforma) tenha um
// caixa próprio (dono 1:1). Usuários que já possuem caixa são ignorados. Aditivo,
// não-destrutivo. Rode uma vez após implantar o "caixa automático por usuário":
//   npm run backfill-caixas -w @bitpix/database

async function firstActiveBranchId(companyId: string, userBranchId: string | null): Promise<string | null> {
  if (userBranchId) return userBranchId;
  const branch = await prisma.branch.findFirst({ where: { companyId, active: true }, orderBy: { createdAt: "asc" }, select: { id: true } });
  return branch?.id ?? null;
}

async function generateRegisterCode(companyId: string, branchId: string): Promise<string> {
  const base = await prisma.cashRegister.count({ where: { companyId, branchId } });
  for (let i = 1; i <= 500; i += 1) {
    const code = `CX-${base + i}`;
    const taken = await prisma.cashRegister.findFirst({ where: { companyId, branchId, code }, select: { id: true } });
    if (!taken) return code;
  }
  return `CX-${randomUUID().slice(0, 6).toUpperCase()}`;
}

async function main(): Promise<void> {
  const users = await prisma.user.findMany({
    where: { status: "ACTIVE", isPlatformAdmin: false, ownedCashRegisters: { none: {} } },
    select: { id: true, name: true, companyId: true, branchId: true },
  });

  let created = 0;
  let skipped = 0;
  for (const user of users) {
    const branchId = await firstActiveBranchId(user.companyId, user.branchId);
    if (!branchId) {
      console.warn(`[skip] ${user.name} (${user.id}): empresa sem filial ativa`);
      skipped += 1;
      continue;
    }
    const code = await generateRegisterCode(user.companyId, branchId);
    await prisma.cashRegister.create({
      data: { companyId: user.companyId, branchId, code, name: `Caixa de ${user.name}`.slice(0, 100), ownerUserId: user.id },
    });
    created += 1;
    console.log(`[ok] caixa ${code} criado para ${user.name}`);
  }

  console.log(`\nBackfill concluído: ${created} caixa(s) criado(s), ${skipped} usuário(s) ignorado(s).`);
}

await main();
await prisma.$disconnect();
