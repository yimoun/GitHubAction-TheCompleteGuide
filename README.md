# GitHubAction-TheCompleteGuide
Ce repository contient tous les travaux relatif au cours sur Udemy "GitHub Actions - The Complete Guide"

---

## Résumé des concepts appris


### 1. Variables d'environnement et Secrets

- Les variables définies au niveau **workflow** (`env:` racine) n'ont accès qu'aux **secrets de repository**.
- Les secrets d'un **Environment** (ex: `testing`) ne sont accessibles qu'à l'intérieur d'un job qui déclare `environment: testing`.
- Si `MONGODB_DB_NAME` est un secret d'environment, il faut le déclarer dans le bloc `env:` du job concerné, pas au niveau racine.

```yaml
# Correct — secret d'environment accessible dans le job
jobs:
  test:
    environment: testing
    env:
      MONGODB_DB_NAME: ${{ secrets.MONGODB_DB_NAME }}
```
---
### 2. Erreurs MongoDB Atlas fréquentes

| Erreur | Cause | Fix |
|---|---|---|
| `bad auth / Authentication failed` (code 8000) | Username ou password incorrect | Vérifier Database Access dans Atlas |
| `MongoNotConnectedError` | Opération lancée après `client.close()` | Ajouter `throw error` dans le catch |
| Timeout / connexion refusée | IP du runner non autorisée | Ajouter `0.0.0.0/0` dans Network Access Atlas |

La présence de `HandshakeError` dans les labels confirme que la connexion réseau a réussi mais que l'authentification a échoué — c'est toujours un problème de credentials.

---
### 3. Ordre des steps : Cache avant Install

L'ordre `Cache dependencies` → `Install dependencies` est **voulu et correct** :

1. `actions/cache` tente de **restaurer** un cache sauvegardé lors d'un run précédent
2. `npm ci` installe les packages (plus vite si le cache a été restauré)
3. En fin de job, `actions/cache` **sauvegarde** automatiquement si c'était un MISS

```
1er run  → Cache MISS → npm ci télécharge tout → cache sauvegardé (très souvant lors du 1er run)
2e run   → Cache HIT  → npm ci skippé ou rapide
```

---

### 4. Stratégie de cache : `~/.npm` vs `node_modules`
| Ce qui est caché | Comportement de npm ci | Gain réel |
|---|---|---|
| `~/.npm` (registre local) | Tourne quand même, recrée `node_modules/` | ~30-40s économisés |
| `node_modules` (packages installés) | Peut être skippé entièrement | ~1m40s économisés |

**Meilleure approche — cacher `node_modules/` et skipper `npm ci` si HIT :**

**Choisir `path` selon la stack :**

| Stack | `path` | `key` |
|---|---|---|
| npm | `node_modules` | `hashFiles('**/package-lock.json')` |
| yarn | `.yarn/cache` | `hashFiles('**/yarn.lock')` |
| pip | `~/.cache/pip` | `hashFiles('**/requirements.txt')` |
| Maven | `~/.m2` | `hashFiles('**/pom.xml')` |
| Go | `~/go/pkg/mod` | `hashFiles('**/go.sum')` |

---
### 5. Cache HIT vs Cache MISS en détail

**Cache MISS** (clé inconnue) :
```
START → actions/cache cherche → rien trouvé
      → npm ci tourne → node_modules/ créé
END   → actions/cache compresse node_modules/ → envoie aux serveurs GitHub
```

**Cache HIT** (clé connue) :
```
START → actions/cache cherche → archive trouvée !
      → télécharge et décompresse dans node_modules/
      → npm ci skippé (if: cache-hit != 'true')
END   → rien à sauvegarder
```

La clé change si et seulement si `package-lock.json` change (ajout/suppression d'une dépendance). C'est pour ça qu'un `npm install X` invalide le cache.

---
### 6. Artifacts — capturer les logs CI

Les Artifacts permettent de télécharger des fichiers après un run (logs, rapports, builds).

```yaml
- name: Run server
  run: |
    set -o pipefail
    npm start 2>&1 | tee server.log &   # background + capture dans fichier
    npx wait-on http://127.0.0.1:$PORT  # attend que le serveur soit prêt

- name: Upload logs
  if: always()   # s'exécute même si le job a échoué
  uses: actions/upload-artifact@v4
  with:
    name: job-logs
    path: |
      server.log
      test.log
```

Points importants :
- `tee` écrit dans un fichier ET affiche dans la console simultanément
- `2>&1` redirige stderr vers stdout (capture les deux)
- `&` en fin de commande = exécution en arrière-plan
- `set -o pipefail` = propage le code d'erreur à travers un pipe (sans ça, `tee` masque les erreurs)
- `if: always()` = le step s'exécute même si les steps précédents ont échoué
- Les artifacts ne sont **téléchargeables qu'une fois le step Upload terminé**

---

### 7. Outputs vs Artifacts
| | Artifacts | Outputs |
|---|---|---|
| Usage | Stocker des fichiers (logs, builds) | Passer des valeurs entre steps/jobs |
| Accès | Téléchargement dans l'UI GitHub | `${{ steps.id.outputs.nom }}` |
| Exemple | `upload-artifact` | `echo "val=x" >> $GITHUB_OUTPUT` |

---

### 8. Conditions sur les steps — `if:` et la condition implicite `success()`

Chaque step a une condition implicite `success()` ajoutée automatiquement par GitHub Actions. Cela signifie que si un step précédent échoue, tous les steps suivants sont **skippés** — même si leur `if:` devrait les faire tourner.

**Piège classique :**
```yaml
- name: Test code
  id: run-test
  run: npm run test

- name: Upload test report
  if: steps.run-test.outcome == 'failure'   # ← ne fonctionne PAS si test échoue
```

GitHub évalue en réalité : `success() && steps.run-test.outcome == 'failure'`
Comme `success()` retourne `false` après un échec, la condition court-circuite → step skippé.

**Solution — utiliser une status check function :**
```yaml
- name: Upload test report
  if: failure() && steps.run-test.outcome == 'failure'   # ← fonctionne
```

| Status function | Retourne `true` quand... |
|---|---|
| `success()` | Aucun step précédent n'a échoué (défaut implicite) |
| `failure()` | Au moins un step précédent a échoué |
| `always()` | Toujours (même en cas d'annulation) |
| `cancelled()` | Le workflow a été annulé |

Dès qu'on utilise une status function explicite dans `if:`, la condition implicite `success()` est supprimée.

---

### 9. Conditions sur les jobs — `needs` context et `if: failure()`

Le contexte `needs` permet à un job d'accéder aux résultats des jobs dont il dépend.

```yaml
report:
  needs: [lint, deploy]
  if: failure()
  runs-on: ubuntu-latest
  steps:
    - name: Output information
      run: |
        echo "Lint job status:  ${{ needs.lint.result }}"
        echo "Test job status:  ${{ needs.test.result }}"
        echo "Build job status: ${{ needs.build.result }}"
```

Points importants :
- `needs.X.result` retourne : `success`, `failure`, `cancelled`, ou `skipped`
- Un job **skippé** (parce que son dépendant a échoué) ne compte pas comme `failure` dans `failure()`
- Pour qu'un job de reporting soit toujours déclenché, utiliser `if: always()`
- `if: failure()` au niveau job se comporte comme au niveau step : la condition implicite est remplacée

---

### 10. Stratégie de matrice (Matrix Strategy)

La matrix strategy permet de lancer le même job avec plusieurs combinaisons de variables.

```yaml
jobs:
  build:
    strategy:
      matrix:
        node-version: [12, 16, 18]
        operating-system: [ubuntu-latest, windows-latest, macos-latest]
    runs-on: ${{ matrix.operating-system }}
    steps:
      - name: Install NodeJS
        uses: actions/setup-node@v3
        with:
          node-version: ${{ matrix.node-version }}
```

GitHub génère le **produit cartésien** : 3 × 3 = 9 jobs ici.

**`include` et `exclude` :**
```yaml
matrix:
  node-version: [12, 16, 18]
  operating-system: [ubuntu-latest, windows-latest, macos-latest]
  include:
    - node-version: 18          # ajoute ou enrichit cette combinaison
      operating-system: ubuntu-latest
  exclude:
    - node-version: 12          # supprime cette combinaison du produit cartésien
      operating-system: windows-latest
```

| Clé | Effet |
|---|---|
| `include` | Ajoute une combinaison absente, ou enrichit une combinaison existante avec des variables supplémentaires |
| `exclude` | Supprime une combinaison spécifique du produit cartésien |

---

### 11. `continue-on-error`

Par défaut, si un job échoue dans une matrice, GitHub Actions annule tous les autres jobs en cours.
`continue-on-error: true` permet de laisser tourner les autres combinaisons malgré l'échec.

```yaml
jobs:
  build:
    continue-on-error: true   # les autres combinaisons de matrice continuent si l'une échoue
    strategy:
      matrix:
        node-version: [12, 16, 18]
```

Différence avec `if: always()` : `continue-on-error` n'empêche pas le job de marquer le run comme **failed** — il laisse juste les autres jobs se terminer. `if: always()` force un step/job à s'exécuter indépendamment du résultat.


### 12. Reusable Workflows — `workflow_call`

Un workflow réutilisable est un fichier `.yml` normal déclenché par `workflow_call` au lieu de `push` ou `pull_request`. Il permet d'extraire une logique commune (ex: deploy) et de l'appeler depuis plusieurs workflows.

#### 13. Déclarer un workflow réutilisable

```yaml
# .github/workflows/reusable.yml
name: Reusable Deploy
on:
  workflow_call:
    inputs:
      artifact-name:
        required: false
        default: dist-files
        type: string
        description: Name of the deployable artifact to download
    outputs:
      result:
        description: Result of the deploy job
        value: ${{ jobs.deploy.outputs.outcome }}
jobs:
  deploy:
    outputs:
      outcome: ${{ steps.set-result.outputs.step-result }}
    runs-on: ubuntu-latest
    steps:
      - name: Get build artifacts
        uses: actions/download-artifact@v4
        with:
          name: ${{ inputs.artifact-name }}
      - name: Set result output
        id: set-result
        run: echo "step-result=success" >> $GITHUB_OUTPUT
```

#### 14. Appeler un workflow réutilisable

```yaml
# Dans n'importe quel autre workflow
jobs:
  deploy:
    needs: build
    uses: ./.github/workflows/reusable.yml   # chemin local
    with:
      artifact-name: dist-files              # passage d'input

  print-result:
    needs: deploy
    runs-on: ubuntu-latest
    steps:
      - run: |
          echo "Deploy result: ${{ needs.deploy.outputs.result }}"
```

#### 15. Chaîne complète des outputs

Les outputs remontent niveau par niveau — un output de step doit être promu en output de job, puis en output de workflow :

```
step output   →   job output   →   workflow output   →   needs.X.outputs.Y
echo "val=x" >> $GITHUB_OUTPUT
              outputs:
                outcome: ${{ steps.id.outputs.val }}
                          outputs:
                            result:
                              value: ${{ jobs.deploy.outputs.outcome }}
                                              ${{ needs.deploy.outputs.result }}
```

#### 16. Points importants

- `uses:` au niveau **job** (pas step) pour appeler un workflow réutilisable
- `with:` passe les inputs, `secrets: inherit` transmet les secrets du workflow appelant
- Un job qui appelle un workflow réutilisable **ne peut pas avoir de `steps:`**
- Les outputs du workflow appelé sont accessibles via `needs.X.outputs.Y` dans les jobs suivants
- `workflow_call` peut coexister avec d'autres triggers (`push`, `schedule`, etc.)

#### 17. Secrets dans un workflow réutilisable

```yaml
# Côté réutilisable — déclaration
on:
  workflow_call:
    secrets:
      DB_PASSWORD:
        required: true

# Côté appelant — transmission automatique
jobs:
  deploy:
    uses: ./.github/workflows/reusable.yml
    secrets: inherit   # transmet tous les secrets du repo appelant
```

---

### 18. Containers et Services

#### Runner vs Container vs Service

```
┌──────────────────────────────────────────────────────┐
│              GitHub Runner (VM ubuntu-latest)         │
│   Node, Python, Git, Docker... pré-installés         │
│                                                      │
│  ┌────────────────────┐   ┌────────────────────────┐ │
│  │  Job container      │◄──│  Service container      │ │
│  │  node:16            │   │  mongo:latest           │ │
│  │  (tes steps         │   │  accessible via le      │ │
│  │   s'exécutent ici)  │   │  hostname "mongo"       │ │
│  └────────────────────┘   └────────────────────────┘ │
└──────────────────────────────────────────────────────┘
```

| | Runner seul | Container (`container:`) | Service (`services:`) |
|---|---|---|---|
| Rôle | Machine hôte généraliste | Environnement d'exécution de tes steps | Dépendance externe (DB, cache...) |
| Quand l'utiliser | Outils déjà présents sur ubuntu-latest | Version précise / environnement spécialisé | Besoin d'une DB ou d'un service annexe pendant les tests |
| Hostname réseau | — | — | Nom de la clé (`mongo`, `redis`...) |

#### Déclarer un container de job

```yaml
jobs:
  test:
    runs-on: ubuntu-latest
    container:
      image: node:16        # tes steps tournent dans Node 16 exactement
```

#### Déclarer un service

```yaml
jobs:
  test:
    runs-on: ubuntu-latest
    container:
      image: node:16
    services:
      mongo:                # hostname réseau = "mongo"
        image: mongo:latest
        env:
          MONGO_INITDB_ROOT_USERNAME: root
          MONGO_INITDB_ROOT_PASSWORD: example
    env:
      MONGODB_CLUSTER_ADDRESS: mongo   # ton app se connecte via ce hostname
```

Points importants :
- Les services appartiennent à **un job spécifique** — chaque job configure ses propres services
- Le container de job et les services **partagent le même réseau** : ils communiquent via hostname
- Sans `container:` sur le job, les services sont quand même accessibles mais via `localhost`
- GitHub démarre les services **avant** les steps du job, puis les arrête à la fin
- Avantage vs installation manuelle : pas de step d'installation, plus rapide, plus fiable

---

### 19. Actions personnalisées (Custom Actions)

Il existe 3 types d'actions personnalisées :

| Type | Fichier d'entrée | Quand l'utiliser |
|---|---|---|
| JavaScript | `main.js` | Actions rapides, pas de dépendance système |
| Docker | `Dockerfile` + script | Environnement contrôlé, n'importe quel langage |
| Composite | `action.yml` (steps) | Regrouper des steps existants sans code |

#### Structure d'une action Docker

```
.github/workflows/actions/deploy-s3-docker/
├── action.yml        ← métadonnées (inputs, outputs, branding)
├── Dockerfile        ← image Docker à construire
├── deployment.py     ← script exécuté dans le container
└── requirements.txt  ← dépendances Python
```

#### `action.yml` — métadonnées de l'action

```yaml
name: 'Deploy to AWS S3'
description: 'Deploy a static website to AWS S3.'
author: 'Nelson YIMOU'
inputs:
  bucket-name:
    description: 'The name of the S3 bucket.'
    required: true
  bucket-region:
    required: false
    default: 'us-east-1'
outputs:
  website-url:
    description: 'URL of the deployed website.'
branding:
  icon: 'terminal'
  color: 'yellow'
runs:
  using: 'docker'
  image: 'Dockerfile'
```

#### Utiliser une action locale dans un workflow

```yaml
- name: Deploy site
  uses: ./.github/workflows/actions/deploy-s3-docker   # chemin relatif depuis la racine du repo
  with:
    bucket-name: ${{ secrets.S3_BUCKET_NAME }}
    dist-folder: ./dist
```

Points importants :
- Le chemin dans `uses:` est **relatif à la racine du repo**, pas au fichier workflow
- `actions/checkout` doit toujours précéder l'utilisation d'une action locale (sinon le runner ne trouve pas les fichiers)
- Pour une action Docker, GitHub construit l'image à chaque run (sauf cache Docker)
- Toujours **épingler la version de Python** dans le Dockerfile (ex: `python:3.12`) — `python:3` suit la dernière version et peut casser si un module standard est supprimé (ex: `cgi` retiré en Python 3.13)

---

### 20. Cycle de vie d'un job — steps automatiques

Chaque job GitHub Actions contient des steps que tu n'as pas écrits, générés automatiquement par le runner :

```
┌─────────────────────────────────────────────────────────┐
│  Set up job                  ← GitHub prépare le runner  │
│  ──────────────────────────────────────────────────────  │
│  Tes steps (dans l'ordre du workflow)                    │
│  ──────────────────────────────────────────────────────  │
│  Post <step N>               ← cleanup en ordre inverse  │
│  Post <step N-1>                                         │
│  ...                                                     │
│  Complete job                ← GitHub ferme le runner    │
└─────────────────────────────────────────────────────────┘
```

| Phase | Ce que fait GitHub | Ce que tu dois savoir |
|---|---|---|
| `Set up job` | Prépare la VM, charge les actions, configure les env vars | Si ça échoue, tes secrets ne sont pas chargés |
| `Post <step>` | Nettoyage enregistré par l'action (ex: sauvegarde du cache) | C'est ici que `actions/cache` **écrit** le cache — si le job est annulé ici, le cache n'est pas sauvegardé |
| `Complete job` | Détruit le runner, rapporte le statut final | — |

#### Pourquoi les steps `Post` ?

Certaines actions ont besoin de faire du nettoyage **après** que tous tes steps ont tourné :
- `actions/checkout` → supprime le token d'authentification
- `actions/cache` → compresse et envoie `node_modules/` vers les serveurs GitHub

Elles déclarent cela dans leur `action.yml` via la clé `post:` :

```yaml
# Extrait interne de actions/cache
runs:
  using: 'node20'
  main: 'dist/restore/index.js'
  post: 'dist/save/index.js'      ← exécuté après tous tes steps
  post-if: success()
```

**Modèle mental :** pense à une pile (stack). Les steps sont empilés à l'exécution, et les `Post` steps se dépilent en ordre inverse — exactement comme un bloc `try / finally` en code.

---

### 21. `branding` — uniquement pour le GitHub Marketplace

Le champ `branding:` dans `action.yml` contrôle l'apparence de l'action sur le **GitHub Marketplace** uniquement :

```yaml
branding:
  icon: 'terminal'   # nom d'icône Feather Icons
  color: 'yellow'    # couleur de fond de l'icône
```

**Il n'apparaît pas dans les logs GitHub Actions.** Le runner ne l'interprète jamais — c'est une métadonnée purement visuelle pour la page Marketplace de l'action.

| Où `branding` est visible | Où il est invisible |
|---|---|
| Page Marketplace de l'action (si publiée publiquement) | Logs de workflow (console runner) |
| Liste des actions dans la recherche Marketplace | UI du job dans l'onglet Actions |

Pour voir le branding, l'action doit être :
1. Dans un repo **public**
2. Publiée sur le Marketplace via les paramètres du repo GitHub

---

### 22. Security concerns

#### Script Injection

Script injection happens when user-controlled data (e.g. an issue title) is interpolated directly into a `run:` shell script via `${{ }}` expressions.

**Vulnerable example:**
```yaml
- name: Assign label
  run: |
    issue_title="${{ github.event.issue.title }}"  # DANGEROUS
```

An attacker creates an issue titled `a"; echo Got your secrets"` — the shell executes the injected command on the runner.

**Solutions (per official GitHub docs):**

1. **Intermediate environment variable** _(recommended)_
```yaml
- name: Assign label
  env:
    ISSUE_TITLE: ${{ github.event.issue.title }}
  run: |
    if [[ "$ISSUE_TITLE" == *"bug"* ]]; then
      echo "Bug issue!"
    fi
```
The value is set as an env var — the shell never interprets it as code.

2. **Use the `github-script` action** to handle GitHub context values in JavaScript, keeping untrusted data out of shell entirely.

3. **Restrict permissions** via `permissions:` to limit the blast radius if injection occurs.

---

### Malicious Third-Party Action

When using third-party actions, choose based on your security tolerance:

| Approach | Security Level | Note |
|---|---|---|
| Only use your own Actions | Highest | Considerable effort to build & maintain |
| Only use Actions by verified creators | Medium | Still not a 100% guarantee |
| Use all public Actions | Lowest | Always analyze the action code first |

### Permission issues

