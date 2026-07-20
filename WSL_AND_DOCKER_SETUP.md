# WSL2 e Docker Desktop — passos manuais (Windows)

> **Diagnóstico atual (auditoria 2026-07-20):**
> - `docker version` → cliente v29.6.1 OK; `docker compose version` → v5.3.0 OK.
> - `docker info` → **HTTP 500** no engine (`dockerDesktopLinuxEngine`) — engine **não** está saudável.
> - `wsl --list --verbose` → **"não tem distribuições instaladas"**.
> - Causa provável: Docker Desktop com backend WSL2 sem distro Linux → engine não sobe.
>
> Estes passos exigem **privilégio de administrador** e provavelmente **reinício**.
> Não posso executá-los automaticamente neste ambiente — siga manualmente.

## 1. Verificar WSL
```powershell
wsl --status
wsl --version
wsl --list --verbose
wsl --list --online
```

## 2. Instalar/atualizar WSL2 + Ubuntu LTS (PowerShell como Administrador)
```powershell
wsl --update
wsl --install -d Ubuntu-24.04
# reinicie se solicitado; no primeiro boot da distro, crie usuário/senha
wsl --set-default-version 2
wsl --set-default Ubuntu-24.04
```
> Nenhum comando aqui é destrutivo. Não remova distros existentes.

## 3. Habilitar recursos do Windows (se `wsl --install` falhar)
```powershell
dism.exe /online /enable-feature /featurename:Microsoft-Windows-Subsystem-Linux /all /norestart
dism.exe /online /enable-feature /featurename:VirtualMachinePlatform /all /norestart
# reinicie a máquina
```

## 4. Configurar Docker Desktop
1. Abrir Docker Desktop → **Settings → General** → *Use the WSL 2 based engine*.
2. **Settings → Resources → WSL Integration** → habilitar a distro Ubuntu-24.04.
3. *Apply & Restart*. Aguardar o engine ficar "running".

## 5. Validar (só então o Docker está funcional)
```powershell
docker version              # deve mostrar Server, não só Client
docker info                 # sem HTTP 500
docker run --rm hello-world
```
```bash
cd /c/Users/moy/Desktop/BitPix
docker compose config
docker compose up -d postgres redis
docker compose ps           # postgres e redis "healthy"
```

## 6. Subir Redis e worker (resolve o readiness 503 atual)
```bash
docker compose up -d redis
docker compose up -d worker      # ou: npm --workspace @bitpix/worker run dev
curl -s http://localhost:3333/health/ready   # deve virar "ready"
```

## Alternativa sem Docker (apenas Redis)
Se preferir não usar Docker agora, rode um Redis nativo/portável apontando `REDIS_URL=redis://localhost:6380` e inicie o worker com `npm --workspace @bitpix/worker run dev`. O readiness passa a `ready` quando Redis + worker estiverem ativos.
