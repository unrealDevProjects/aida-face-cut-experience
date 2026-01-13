# Git - Guía Rápida

## 0) Precheck rápido

En el terminal, dentro del proyecto:

```bash
git --version
git status
```

- Si `git status` dice "not a git repository", ve a la sección **A**.
- Si ya es repo, ve a **B**.

---

## A) Si AÚN no es un repo (init + primer push)

```bash
git init
git add .
git commit -m "Initial commit"
```

Crea el repo en GitHub (vacío, sin README si ya tienes uno) y copia la URL (HTTPS o SSH).

### Conecta el remoto:

**HTTPS:**
```bash
git remote add origin https://github.com/TU_USUARIO/TU_REPO.git
```

**SSH:**
```bash
git remote add origin git@github.com:TU_USUARIO/TU_REPO.git
```

### Sube rama principal:

```bash
git branch -M main
git push -u origin main
```

---

## B) Si YA es repo (el push normal)

```bash
git status
git add .
git commit -m "Update"
git push
```

---

## C) Autenticación (la parte donde la gente llora)

### Opción 1 (recomendada): GitHub CLI

Si tienes `gh` instalado:

```bash
gh auth login
```

Luego:

```bash
git push
```

### Opción 2: HTTPS con token (PAT)

GitHub ya no usa password. Necesitas un **Personal Access Token** como password.

1. En GitHub: **Settings → Developer settings → Personal access tokens → Tokens (classic)**
2. Scope mínimo: `repo`.
3. Cuando `git push` te pida password, pegas el token.

### Opción 3: SSH (más pro)

**Genera clave:**
```bash
ssh-keygen -t ed25519 -C "tu_email"
```

Enter a todo.

**Arranca agente y carga clave:**
```bash
eval "$(ssh-agent -s)"
ssh-add ~/.ssh/id_ed25519
```

**Copia la pública y pégala en GitHub → Settings → SSH keys:**
```bash
cat ~/.ssh/id_ed25519.pub
```

**Cambia el remote a SSH (si estabas en HTTPS):**
```bash
git remote set-url origin git@github.com:TU_USUARIO/TU_REPO.git
git push
```

---

## D) Errores típicos y solución rápida

### "src refspec main does not match any"

→ No tienes commits aún o tu rama se llama `master`.

```bash
git commit -m "Init" --allow-empty
git branch -M main
git push -u origin main
```

### "remote origin already exists"

```bash
git remote -v
git remote set-url origin <URL_CORRECTA>
```

### "rejected (non-fast-forward)"

Hay cambios en GitHub que tú no tienes:

```bash
git pull --rebase origin main
git push
```

