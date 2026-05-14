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

