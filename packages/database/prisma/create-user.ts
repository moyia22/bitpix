import { resolve } from "node:path";
import argon2 from "argon2";
import { config } from "dotenv";

config({ path: resolve(process.cwd(), "../../.env") });
const { prisma } = await import("../src/index.js");

// Cria (ou atualiza) um usuário com uma função existente da empresa.
// Padrão: função OPERATOR (permissão padrão de balcão) na empresa loja-modelo.
// Uso:
//   NEW_USER_EMAIL=caixa@bitpix.local NEW_USER_PASSWORD='SenhaForte123' \
//   NEW_USER_NAME='Operador de Caixa' npm run db:create-user
async function main(): Promise<void> {
  const email = (process.env.NEW_USER_EMAIL ?? "").trim().toLowerCase();
  const password = process.env.NEW_USER_PASSWORD ?? "";
  const name = (process.env.NEW_USER_NAME ?? "Novo usuário").trim();
  const roleKey = (process.env.NEW_USER_ROLE ?? "OPERATOR").trim();
  const companySlug = (process.env.NEW_USER_COMPANY_SLUG ?? "loja-modelo").trim();

  if (!email || !email.includes("@")) throw new Error("Informe NEW_USER_EMAIL válido");
  if (password.length < 8) throw new Error("NEW_USER_PASSWORD deve ter pelo menos 8 caracteres");

  const company = await prisma.company.findUnique({ where: { slug: companySlug }, select: { id: true, displayName: true } });
  if (!company) throw new Error(`Empresa "${companySlug}" não encontrada. Rode o seed antes.`);

  const role = await prisma.role.findUnique({ where: { companyId_key: { companyId: company.id, key: roleKey } }, select: { id: true, name: true } });
  if (!role) throw new Error(`Função "${roleKey}" não existe na empresa. Funções: ADMIN, MANAGER, OPERATOR.`);

  const branch = await prisma.branch.findFirst({ where: { companyId: company.id, active: true }, select: { id: true }, orderBy: { createdAt: "asc" } });
  const passwordHash = await argon2.hash(password, { type: argon2.argon2id });

  const user = await prisma.user.upsert({
    where: { normalizedEmail: email },
    create: { companyId: company.id, branchId: branch?.id ?? null, name, email, normalizedEmail: email, passwordHash, status: "ACTIVE", mustResetPassword: false },
    update: { name, passwordHash, status: "ACTIVE", failedLoginAttempts: 0, lockedUntil: null, mustResetPassword: false },
    select: { id: true, publicId: true, email: true },
  });

  await prisma.userRole.deleteMany({ where: { userId: user.id } });
  await prisma.userRole.create({ data: { companyId: company.id, userId: user.id, roleId: role.id } });

  console.info(`Usuário pronto: ${user.email} · função ${role.name} · empresa ${company.displayName}`);
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "Falha ao criar usuário");
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
