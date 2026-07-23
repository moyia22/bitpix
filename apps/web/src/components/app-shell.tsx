"use client";

import type { CashSessionDto, PermissionKey, SessionPrincipal } from "@bitpix/contracts";
import {
  Activity,
  BarChart3,
  Bell,
  Building2,
  FileClock,
  History,
  Menu,
  ReceiptText,
  Settings,
  ShieldCheck,
  ShoppingBag,
  Users,
  WalletCards,
  X,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { BrandMark } from "./brand-mark";
import { LogoutButton } from "./logout-button";
import { ThemeToggle } from "./theme-toggle";

interface NavItem {
  href: string;
  label: string;
  icon: typeof ShoppingBag;
  permission?: PermissionKey;
}

const primaryNavigation: NavItem[] = [
  { href: "/nova-venda", label: "Nova venda", icon: ShoppingBag, permission: "pix.charge.create" },
  { href: "/dashboard", label: "Dashboard", icon: BarChart3, permission: "dashboard.read" },
  { href: "/historico", label: "Histórico", icon: History, permission: "sales.read" },
  { href: "/caixa", label: "Caixa", icon: WalletCards, permission: "cash.session.read" },
  { href: "/relatorios", label: "Relatórios", icon: ReceiptText, permission: "reports.sales.read" },
  { href: "/notificacoes", label: "Notificações", icon: Bell, permission: "notifications.read" },
  { href: "/configuracoes", label: "Configurações", icon: Settings, permission: "settings.read" },
];

const adminNavigation: NavItem[] = [
  { href: "/usuarios", label: "Usuários", icon: Users, permission: "users.read" },
  { href: "/funcoes", label: "Funções", icon: ShieldCheck, permission: "roles.read" },
  { href: "/filiais", label: "Filiais", icon: Building2, permission: "branches.read" },
  { href: "/auditoria", label: "Auditoria", icon: FileClock, permission: "audit.read" },
];
const platformNavigation: NavItem[] = [{ href: "/plataforma", label: "Plataforma", icon: ShieldCheck, permission: "platform.dashboard.read" }];

function NavigationGroup({
  title,
  items,
  permissions,
  onNavigate,
}: {
  title?: string;
  items: NavItem[];
  permissions: Set<PermissionKey>;
  onNavigate: () => void;
}) {
  const pathname = usePathname();
  const visibleItems = items.filter((item) => !item.permission || permissions.has(item.permission));
  if (visibleItems.length === 0) return null;

  return (
    <div className="mt-6">
      {title && <p className="mb-2 px-3 text-[0.7rem] font-bold uppercase tracking-[0.13em] text-[var(--ink-faint)]">{title}</p>}
      <nav className="space-y-1" aria-label={title ?? "Navegação principal"}>
        {visibleItems.map((item) => {
          const active = pathname === item.href;
          const Icon = item.icon;
          return (
            <Link
              href={item.href}
              key={item.href}
              onClick={onNavigate}
              aria-current={active ? "page" : undefined}
              data-active={active}
              className={`nav-link group flex min-h-11 items-center gap-3 rounded-xl px-3 text-[0.94rem] font-semibold transition-colors ${active ? "text-[var(--primary-strong)]" : "text-[var(--ink-muted)] hover:bg-[var(--surface-muted)] hover:text-[var(--ink)]"}`}
            >
              <Icon size={19} strokeWidth={active ? 2.2 : 1.8} aria-hidden="true" />
              {item.label}
              {active && <span className="ml-auto h-5 w-1 rounded-full bg-[var(--primary)]" aria-hidden="true" />}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}

const healthUrl = `${process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3333"}/health/live`;

// Indicador honesto de conectividade: antes o texto "API conectada" era fixo.
function useApiHealth(): boolean {
  const [healthy, setHealthy] = useState(true);
  useEffect(() => {
    let active = true;
    const check = async () => {
      try {
        const response = await fetch(healthUrl, { cache: "no-store" });
        if (active) setHealthy(response.ok);
      } catch {
        if (active) setHealthy(false);
      }
    };
    void check();
    const timer = window.setInterval(() => void check(), 30_000);
    return () => { active = false; window.clearInterval(timer); };
  }, []);
  return healthy;
}

export function AppShell({ principal, currentCash, children }: { principal: SessionPrincipal; currentCash: CashSessionDto | null; children: ReactNode }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const apiHealthy = useApiHealth();
  const permissions = new Set(principal.permissions);
  const initials = principal.user.name.split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase();

  return (
    <div className="app-shell">
      {sidebarOpen && (
        <button
          type="button"
          aria-label="Fechar menu"
          onClick={() => setSidebarOpen(false)}
          className="fixed inset-0 z-[35] bg-[#0a1020]/45 lg:hidden"
        />
      )}

      <aside className="app-sidebar" data-open={sidebarOpen} aria-label="Menu lateral">
        <div className="flex items-center justify-between px-2">
          <BrandMark />
          <button type="button" className="icon-button mobile-menu-button" onClick={() => setSidebarOpen(false)} aria-label="Fechar menu">
            <X size={19} />
          </button>
        </div>

        <NavigationGroup items={primaryNavigation} permissions={permissions} onNavigate={() => setSidebarOpen(false)} />
        <NavigationGroup title="Administração" items={adminNavigation} permissions={permissions} onNavigate={() => setSidebarOpen(false)} />
        <NavigationGroup title="Superadmin" items={platformNavigation} permissions={permissions} onNavigate={() => setSidebarOpen(false)} />

        <div className="mt-auto border-t border-[var(--border)] pt-4">
          <div className="mb-3 flex items-center gap-3 rounded-xl px-3 py-2">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-[var(--primary-soft)] text-sm font-bold text-[var(--primary-strong)]">{initials}</span>
            <div className="min-w-0">
              <p className="truncate text-sm font-bold">{principal.user.name}</p>
              <p className="truncate text-xs text-[var(--ink-muted)]">{principal.roles[0] ?? "Usuário"}</p>
            </div>
            <span className="ml-auto h-2 w-2 rounded-full bg-[var(--success)]" title="Online" />
          </div>
          <p className="mb-2 truncate px-3 text-xs text-[var(--ink-faint)]">{principal.company.displayName}</p>
          <LogoutButton />
        </div>
      </aside>

      <div className="app-main">
        <header className="topbar">
          <div className="flex items-center gap-3">
            <button type="button" className="icon-button mobile-menu-button" onClick={() => setSidebarOpen(true)} aria-label="Abrir menu">
              <Menu size={20} />
            </button>
            <div className="hidden items-center gap-2 text-sm sm:flex">
              <WalletCards size={17} className="text-[var(--ink-faint)]" aria-hidden="true" />
              <span className="font-semibold">{currentCash ? `${currentCash.cashRegister.name} · ${currentCash.cashRegister.code}` : "Caixa operacional"}</span>
              <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${currentCash ? "bg-[var(--success-soft)] text-[var(--success)]" : "bg-[var(--warning-soft)] text-[var(--warning)]"}`}>
                {currentCash ? "Aberto" : "Fechado"}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span className={`hidden items-center gap-2 text-sm font-semibold md:flex ${apiHealthy ? "text-[var(--success)]" : "text-[var(--danger)]"}`}>
              <Activity size={17} aria-hidden="true" /> {apiHealthy ? "API conectada" : "API instável"}
            </span>
            <ThemeToggle />
            <span className="hidden text-sm font-semibold sm:inline">{principal.user.name.split(" ")[0]}</span>
          </div>
        </header>
        <main id="conteudo-principal">{children}</main>
      </div>
    </div>
  );
}
