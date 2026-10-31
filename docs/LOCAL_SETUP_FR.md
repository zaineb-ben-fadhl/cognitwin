# Lancer CogniTwin sur Windows

Dans un terminal PowerShell :

```powershell
cd C:\Users\DELL\Desktop\defis\cognitwin
npm.cmd ci
npm.cmd run dev
```

Ouvrir http://localhost:5173. Laisser le terminal ouvert. `Ctrl+C` arrête le projet. Node.js doit respecter la version indiquée dans `.nvmrc` (et au minimum 20.19).

## Ajouter la clé du coach IA (optionnel)

Le coach à règles fonctionne déjà sans clé. Une clé Anthropic permet de tester la reformulation avec un vrai modèle ; elle nécessite un compte fournisseur disposant d'un accès API et peut entraîner des frais d'usage.

1. Ouvrir `C:\Users\DELL\Desktop\defis\cognitwin\.env` dans l'éditeur.
2. Repérer la ligne `ANTHROPIC_API_KEY=`.
3. Coller sa propre clé immédiatement après le signe `=`, sans espaces ni guillemets.
4. Enregistrer avec `Ctrl+S`.
5. Arrêter puis relancer `npm.cmd run dev` pour recharger le fichier.
6. Dans l'application, lire le consentement puis activer **Privacy & settings → AI narrative coach** si les transmissions décrites conviennent.
7. Vérifier `http://localhost:5173/api/health` : `llm: true` indique qu'une clé est configurée. Cela ne prouve pas encore sa validité ; envoyer ensuite une question de test sans données personnelles et ouvrir **Why?** pour vérifier la source et un éventuel repli.

Ne jamais coller la clé dans le chat, le code, un dépôt public ou une capture. Le fichier `.env` est exclu par `.gitignore` et `.dockerignore`. Si le modèle n'est pas accessible au compte, ajuster `COACH_MODEL` selon l'accès disponible ; une erreur du fournisseur conserve le coach local.

Le test réel optionnel se lance avec `node scripts/check-live-coach.mjs` pendant que l'application tourne. Il utilise un profil fictif et peut consommer des crédits API. `insufficient_credits` signifie que le fournisseur refuse l'appel faute de crédits : vérifier le solde dans la console Anthropic, puis relancer le test. La présence d'une clé ne suffit pas à garantir l'accès au modèle.

Sur un réseau utilisant des certificats approuvés par Windows, `COACH_USE_SYSTEM_CA=true` ajoute les certificats de confiance du système à ceux de Node (version récente de Node 22/24). La vérification HTTPS reste active. Cette option a été activée localement après constat d'une erreur de certificat.

## Vérifications reproductibles

```powershell
npm.cmd run check
npm.cmd run validate
npm.cmd run docs
```

`check` exécute TypeScript, les tests et la compilation. Les simulations utilisent des profils synthétiques ; elles ne remplacent pas un essai avec des utilisateurs réels. Les tests caméra, microphone et fournisseur utilisent des doubles de test et ne certifient pas le matériel réel.

Pour la version compilée : `npm.cmd run build`, puis `npm.cmd start` et ouvrir http://localhost:8787. Le serveur de développement doit être arrêté avant de lancer un second serveur sur ce même port.
