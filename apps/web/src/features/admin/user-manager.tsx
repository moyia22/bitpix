"use client";

import { KeyRound, LoaderCircle, Pencil, Plus, Power, RotateCcw, ShieldOff, Trash2, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { StepUpModal } from "./step-up-modal";

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3333";

type User = {
  publicId: string;
  name: string;
  email: string;
  status: string;
  branch: { publicId: string; name: string } | null;
  roles: Array<{ role: { key: string; name: string } }>;
  activeSessionCount: number;
};
type Role = { key: string; name: string };
type Branch = { publicId: string; name: string };
type StepUpAction = { kind: "delete" | "reset-mfa"; user: User };

export function UserManager({
  users,
  roles,
  branches,
  canCreate,
  canUpdate,
  canRevoke,
}: {
  users: User[];
  roles: Role[];
  branches: Branch[];
  canCreate: boolean;
  canUpdate: boolean;
  canRevoke: boolean;
}) {
  const router = useRouter();
  const [createOpen, setCreateOpen] = useState(false);
  const [editUser, setEditUser] = useState<User | null>(null);
  const [passwordUser, setPasswordUser] = useState<User | null>(null);
  const [stepUp, setStepUp] = useState<StepUpAction | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [modalError, setModalError] = useState("");

  const call = async (path: string, options: RequestInit) => {
    const response = await fetch(`${apiUrl}/api/v1${path}`, {
      ...options,
      credentials: "include",
      headers: { "content-type": "application/json", ...options.headers },
    });
    const result = (await response.json().catch(() => ({}))) as { error?: { message?: string }; data?: unknown };
    if (!response.ok) throw new Error(result.error?.message ?? "Operação não concluída.");
    return result;
  };

  const create = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setModalError("");
    const data = new FormData(event.currentTarget);
    try {
      await call("/users", {
        method: "POST",
        body: JSON.stringify({
          name: String(data.get("name")),
          email: String(data.get("email")),
          password: String(data.get("password")),
          branchPublicId: String(data.get("branch")) || null,
          roleKeys: [String(data.get("role"))],
          requirePasswordChange: data.get("requireChange") === "on",
        }),
      });
      setCreateOpen(false);
      setNotice("Usuário criado.");
      router.refresh();
    } catch (error) {
      setModalError(error instanceof Error ? error.message : "Falha ao criar.");
    } finally {
      setBusy(false);
    }
  };

  const saveEdit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!editUser) return;
    setBusy(true);
    setModalError("");
    const data = new FormData(event.currentTarget);
    try {
      await call(`/users/${editUser.publicId}`, {
        method: "PATCH",
        body: JSON.stringify({
          name: String(data.get("name")),
          email: String(data.get("email")),
          branchPublicId: String(data.get("branch")) || null,
          roleKeys: [String(data.get("role"))],
        }),
      });
      setEditUser(null);
      setNotice("Usuário atualizado.");
      router.refresh();
    } catch (error) {
      setModalError(error instanceof Error ? error.message : "Falha ao atualizar.");
    } finally {
      setBusy(false);
    }
  };

  const submitPassword = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!passwordUser) return;
    setBusy(true);
    setModalError("");
    const data = new FormData(event.currentTarget);
    try {
      await call(`/users/${passwordUser.publicId}/set-password`, {
        method: "POST",
        body: JSON.stringify({
          password: String(data.get("password")),
          requirePasswordChange: data.get("requireChange") === "on",
          mfaCode: String(data.get("mfaCode")),
        }),
      });
      setPasswordUser(null);
      setNotice(`Senha de ${passwordUser.name} redefinida. As sessões foram encerradas.`);
      router.refresh();
    } catch (error) {
      setModalError(error instanceof Error ? error.message : "Falha ao redefinir a senha.");
    } finally {
      setBusy(false);
    }
  };

  const runStepUp = async (code: string) => {
    if (!stepUp) return;
    setBusy(true);
    setModalError("");
    try {
      if (stepUp.kind === "delete") {
        const result = (await call(`/users/${stepUp.user.publicId}`, { method: "DELETE", body: JSON.stringify({ mfaCode: code }) })) as { data?: { deleted?: boolean } };
        setNotice(result.data?.deleted ? `${stepUp.user.name} foi excluído.` : `${stepUp.user.name} possui histórico e foi desativado.`);
      } else {
        await call(`/users/${stepUp.user.publicId}/reset-mfa`, { method: "POST", body: JSON.stringify({ mfaCode: code }) });
        setNotice(`2FA de ${stepUp.user.name} redefinido.`);
      }
      setStepUp(null);
      router.refresh();
    } catch (error) {
      setModalError(error instanceof Error ? error.message : "Falha na operação.");
    } finally {
      setBusy(false);
    }
  };

  const toggle = async (user: User) => {
    setBusy(true);
    try {
      await call(`/users/${user.publicId}`, { method: "PATCH", body: JSON.stringify({ status: user.status === "ACTIVE" ? "INACTIVE" : "ACTIVE" }) });
      router.refresh();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Falha.");
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (user: User) => {
    setBusy(true);
    try {
      await call(`/users/${user.publicId}/revoke-sessions`, { method: "POST" });
      setNotice(`Sessões de ${user.name} revogadas.`);
      router.refresh();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Falha.");
    } finally {
      setBusy(false);
    }
  };

  const openCreate = () => { setModalError(""); setCreateOpen((open) => !open); };
  const openEdit = (user: User) => { setModalError(""); setEditUser(user); };
  const openPassword = (user: User) => { setModalError(""); setPasswordUser(user); };
  const openStepUp = (action: StepUpAction) => { setModalError(""); setStepUp(action); };

  return (
    <>
      {canCreate && (
        <div className="admin-actions">
          <button className="primary-button" onClick={openCreate} type="button"><Plus size={17} />Novo usuário</button>
        </div>
      )}

      {createOpen && (
        <form className="card inline-create user-create" onSubmit={create}>
          <label><span>Nome</span><input name="name" required /></label>
          <label><span>E-mail</span><input type="email" name="email" required /></label>
          <label><span>Senha inicial</span><input type="password" name="password" minLength={6} required /></label>
          <label><span>Filial</span><select name="branch"><option value="">Todas</option>{branches.map((branch) => <option value={branch.publicId} key={branch.publicId}>{branch.name}</option>)}</select></label>
          <label><span>Função</span><select name="role" required>{roles.map((role) => <option value={role.key} key={role.key}>{role.name}</option>)}</select></label>
          <label className="check-row" style={{ gridColumn: "1 / -1" }}><input type="checkbox" name="requireChange" /> Exigir troca de senha no 1º login</label>
          {modalError && <div className="cash-notice cash-notice-error" role="alert" style={{ gridColumn: "1 / -1" }}>{modalError}</div>}
          <button className="primary-button" disabled={busy}>{busy ? <LoaderCircle className="spin" /> : <Plus />}Criar</button>
        </form>
      )}

      {notice && <p className="inline-notice">{notice}</p>}

      <section className="card data-card">
        <div className="table-scroll">
          <table>
            <thead><tr><th>Usuário</th><th>Filial</th><th>Função</th><th>Sessões</th><th>Estado</th><th>Ações</th></tr></thead>
            <tbody>
              {users.map((user) => (
                <tr key={user.publicId}>
                  <td><strong>{user.name}</strong><small>{user.email}</small></td>
                  <td>{user.branch?.name ?? "Todas"}</td>
                  <td>{user.roles.map(({ role }) => role.name).join(", ")}</td>
                  <td>{user.activeSessionCount}</td>
                  <td><span className={user.status === "ACTIVE" ? "positive" : "negative"}>{user.status === "ACTIVE" ? "Ativo" : user.status === "BLOCKED" ? "Bloqueado" : "Inativo"}</span></td>
                  <td>
                    <div className="row-actions">
                      {canUpdate && <button type="button" title="Editar" disabled={busy} onClick={() => openEdit(user)}><Pencil /></button>}
                      {canUpdate && <button type="button" title="Redefinir senha" disabled={busy} onClick={() => openPassword(user)}><KeyRound /></button>}
                      {canUpdate && <button type="button" title="Redefinir 2FA" disabled={busy} onClick={() => openStepUp({ kind: "reset-mfa", user })}><ShieldOff /></button>}
                      {canRevoke && <button type="button" title="Revogar sessões" disabled={busy} onClick={() => void revoke(user)}><RotateCcw /></button>}
                      {canUpdate && <button type="button" title={user.status === "ACTIVE" ? "Desativar" : "Ativar"} disabled={busy} onClick={() => void toggle(user)}><Power /></button>}
                      {canUpdate && <button type="button" title="Excluir" disabled={busy} onClick={() => openStepUp({ kind: "delete", user })}><Trash2 /></button>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {editUser && (
        <div className="history-modal" role="dialog" aria-modal="true" aria-label="Editar usuário" onClick={() => setEditUser(null)}>
          <form className="card history-detail" style={{ maxWidth: 520 }} onClick={(event) => event.stopPropagation()} onSubmit={saveEdit}>
            <div className="flex items-start justify-between gap-4">
              <div><p className="cash-kicker">Administração</p><h2 style={{ margin: 0, fontFamily: "var(--font-display)" }}>Editar usuário</h2></div>
              <button type="button" onClick={() => setEditUser(null)} aria-label="Fechar" style={{ border: 0, background: "transparent", color: "var(--ink-muted)" }}><X size={18} /></button>
            </div>
            <label className="field-label mt-5" htmlFor="edit-name">Nome</label>
            <input id="edit-name" className="field-input" name="name" defaultValue={editUser.name} required />
            <label className="field-label mt-5" htmlFor="edit-email">E-mail</label>
            <input id="edit-email" className="field-input" type="email" name="email" defaultValue={editUser.email} required />
            <label className="field-label mt-5" htmlFor="edit-role">Função</label>
            <select id="edit-role" className="field-input" name="role" defaultValue={editUser.roles[0]?.role.key ?? ""} required>{roles.map((role) => <option value={role.key} key={role.key}>{role.name}</option>)}</select>
            <label className="field-label mt-5" htmlFor="edit-branch">Filial</label>
            <select id="edit-branch" className="field-input" name="branch" defaultValue={editUser.branch?.publicId ?? ""}><option value="">Todas</option>{branches.map((branch) => <option value={branch.publicId} key={branch.publicId}>{branch.name}</option>)}</select>
            {modalError && <div className="cash-notice cash-notice-error mt-3" role="alert">{modalError}</div>}
            <button className="primary-button mt-6 w-full" disabled={busy}>{busy ? <LoaderCircle className="animate-spin" size={18} /> : <Pencil size={18} />} Salvar</button>
          </form>
        </div>
      )}

      {passwordUser && (
        <div className="history-modal" role="dialog" aria-modal="true" aria-label="Redefinir senha" onClick={() => setPasswordUser(null)}>
          <form className="card history-detail" style={{ maxWidth: 460 }} onClick={(event) => event.stopPropagation()} onSubmit={submitPassword}>
            <div className="flex items-start justify-between gap-4">
              <div><p className="cash-kicker">{passwordUser.name}</p><h2 style={{ margin: 0, fontFamily: "var(--font-display)" }}>Redefinir senha</h2></div>
              <button type="button" onClick={() => setPasswordUser(null)} aria-label="Fechar" style={{ border: 0, background: "transparent", color: "var(--ink-muted)" }}><X size={18} /></button>
            </div>
            <label className="field-label mt-5" htmlFor="pw-new">Nova senha</label>
            <input id="pw-new" className="field-input" type="password" name="password" minLength={6} required autoComplete="new-password" />
            <label className="check-row mt-3"><input type="checkbox" name="requireChange" /> Exigir troca no 1º login</label>
            <label className="field-label mt-5" htmlFor="pw-code">Seu código de 2FA</label>
            <input id="pw-code" className="field-input" name="mfaCode" inputMode="numeric" pattern="\d{6}" maxLength={6} required autoComplete="one-time-code" />
            {modalError && <div className="cash-notice cash-notice-error mt-3" role="alert">{modalError}</div>}
            <button className="primary-button mt-6 w-full" disabled={busy}>{busy ? <LoaderCircle className="animate-spin" size={18} /> : <KeyRound size={18} />} Redefinir senha</button>
          </form>
        </div>
      )}

      {stepUp && (
        <StepUpModal
          title={stepUp.kind === "delete" ? `Excluir ${stepUp.user.name}` : `Redefinir 2FA de ${stepUp.user.name}`}
          description={stepUp.kind === "delete" ? "Exclui a conta se não houver histórico; caso contrário, ela é desativada. Confirme com seu código 2FA." : "O usuário precisará configurar o 2FA novamente. Confirme com seu código 2FA."}
          busy={busy}
          error={modalError}
          onConfirm={(code) => void runStepUp(code)}
          onClose={() => setStepUp(null)}
        />
      )}
    </>
  );
}
