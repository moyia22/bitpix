// Política de obrigatoriedade de MFA — módulo isolado para evitar ciclo de
// import entre auth.service.ts e auth.guard.ts.
const ADMIN_PERMISSION_PREFIXES = ["users.", "roles."] as const;

export function requiresMfa(user: { isPlatformAdmin: boolean }, permissions: Iterable<string>): boolean {
  if (user.isPlatformAdmin) return true;
  for (const permission of permissions) {
    if (ADMIN_PERMISSION_PREFIXES.some((prefix) => permission.startsWith(prefix))) return true;
  }
  return false;
}
