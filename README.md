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

---

### 12. Organisation du repo par sections de tuto

Pour travailler sur plusieurs sections d'un même cours sans créer plusieurs repos GitHub :

- Créer une branche par section : `section-2`, `section-7`, etc.
- Utiliser un wildcard dans le trigger pour couvrir toutes les branches :

```yaml
on:
  push:
    branches:
      - main
      - section-*
```

