# Study Buddy — frontend

Interface **React + TypeScript** (Vite) d’un tuteur Python pour débutants. L’étudiant discute avec le chatbot, ajoute des notes personnelles, choisit un modèle et voit les réponses s’afficher en streaming.

Le frontend et le backend sont volontairement dans **deux dépôts distincts** :

- **Application en ligne** : [https://study-buddy-ashy-pi.vercel.app/](https://study-buddy-ashy-pi.vercel.app/)
- Backend : [https://github.com/FulbertDev-AI/RODIUMAI-BOOTCAMP-bootcamp-chatbot-backend.git](https://github.com/FulbertDev-AI/RODIUMAI-BOOTCAMP-bootcamp-chatbot-backend.git)
- Frontend : [https://github.com/FulbertDev-AI/RODIUMAI-BOOTCAMP-bootcamp-chatbot-frontend.git](https://github.com/FulbertDev-AI/RODIUMAI-BOOTCAMP-bootcamp-chatbot-frontend.git)

---

## Technologies

| Rôle | Outil |
| --- | --- |
| UI | React 19, TypeScript |
| Bundler / serveur de dev | Vite 8 |
| Markdown des réponses assistant | `react-markdown` |
| Tests | Vitest |
| Lint | oxlint |

Aucune clé API n’est lue dans le navigateur (pas de variable `VITE_*` pour RodiumAI).

---

## Installation et lancement

Le backend doit tourner **séparément** sur le port **8000**. Depuis `bootcamp-chatbot-backend` :

```bash
uv run fastapi dev main.py
```

Puis, depuis ce dépôt(bootcamp-chatbot-frontend) :

```bash
npm install
npm run dev
```

Ouvrir **http://localhost:5173**.

Les appels du navigateur ciblent `/api/...` sur l’origine Vite. Le proxy (`vite.config.ts`) réécrit le préfixe `/api` et transmet vers `http://localhost:8000`. Le navigateur ne parle donc qu’à Vite : pas de configuration CORS nécessaire en développement local.

Autres scripts : `npm test`, `npm run lint`, `npm run build`, `npm run preview`.

---

## Fonctionnalités obligatoires

### Rôle custom `note`

L’étudiant peut saisir une note personnelle sous le composer (`NoteComposer`). Le frontend envoie `POST /api/conversations/{id}/notes` avec `{ "content": "..." }`. Le backend persiste la note (`role: "note"`) ; elle revient aussi dans `GET /conversations/{id}/messages`.

Dans l’interface, une note n’est **pas** une bulle user/assistant : encadré distinct, libellé « Note personnelle ». Le composer de chat n’envoie **jamais** une note via `POST /chat`.

Le filtrage vis-à-vis du LLM est **côté backend** : le rôle `note` est exclu de l’historique envoyé au modèle. Le frontend n’a pas cette responsabilité.

### Prompt système spécialisé

Le prompt tuteur (Python pour débutants, pédagogie guidée) est défini **côté backend**, dans `prompts/system.md`. Le frontend n’assemble pas ce prompt : il se contente d’appeler l’API de chat.

### Streaming

`POST /chat` n’est pas une réponse JSON unique. Le frontend utilise `fetch()` (pas `EventSource`, inadapté à un POST), lit `response.body.getReader()`, décode en UTF-8 et parse les événements SSE (`data: ...`), y compris lorsqu’un événement est coupé entre deux chunks HTTP.

| Événement | Comportement UI |
| --- | --- |
| `delta` | Concaténation progressive sur **une** bulle assistant |
| `done` | Remplacement par le `reply` complet, notification éventuelle, `usage` éventuel |
| `[DONE]` | Fin propre de la lecture du flux |
| `error` | Échec : pas de réponse considérée comme réussie |

Une bulle assistant vide est créée dès l’envoi ; les deltas la remplissent. Le backend ne persiste le tour (user + assistant) qu’après une **fin normale** du stream.

### Choix du modèle

Au démarrage, `GET /api/models` alimente le sélecteur. La liste affichée vient de cette réponse (ids + labels), pas d’une liste figée dans le code comme source de vérité. Sélection initiale : champ `default` du backend, sinon le premier modèle renvoyé.

Liste actuellement exposée par le backend :

| `id` | Libellé |
| --- | --- |
| `openai/gpt-4o` | GPT-4o |
| `openai/gpt-4o-mini` | GPT-4o Mini |
| `anthropic/claude-sonnet-4-5-20250929` | Claude Sonnet 4.5 |
| `anthropic/claude-haiku-4-5-20251001` | Claude Haiku 4.5 |
| `google/gemini-2.5-flash` | Gemini 2.5 Flash |

Chaque `POST /chat` inclut `{ conversation_id, message, model }`. Changer de modèle en cours de conversation **ne crée pas** une nouvelle conversation : seul le prochain message utilise le nouvel id. La **validation** de la liste autorisée est faite **côté serveur**.

---

## Erreurs, Retry et Stop

### Erreur LLM / SSE

Si le flux échoue (`type: error`, coupure sans `done`, erreur HTTP) :

- le couple optimiste user + assistant (y compris une réponse partielle) est retiré ;
- le texte est remis dans le composer (premier envoi) ;
- une bannière **Impossible d'obtenir une réponse.** propose **Réessayer**.

Ce n’est pas un succès : rien n’est présenté comme un tour sauvegardé.

### Retry

**Réessayer** relance le même `POST /chat` avec la conversation, le **texte** et le **modèle figés** au moment de l’échec (`failedChat` en mémoire React, pas de `localStorage`). Un changement ultérieur du sélecteur n’est **pas** appliqué au retry.

### Stop

Pendant un envoi (y compris avant le premier `delta`), le bouton **Envoyer** est remplacé par **Arrêter**. Un `AbortController` est créé pour le tour ; son `signal` est passé à `fetch`. Le clic appelle `abort()`.

Un arrêt volontaire (`AbortError`) n’est **pas** une erreur : pas de bannière Retry, pas de `failedChat`. Rollback du couple optimiste ; pour un envoi initial, le texte est remis dans le composer afin de pouvoir le renvoyer manuellement.

---

## Tokens consommés

L’événement SSE `done` peut contenir `usage` (`prompt_tokens`, `completion_tokens`, `total_tokens`) ou `null`. Après un stream **réussi**, le frontend affiche par exemple :

`125 tokens · 100 entrée · 25 sortie`

Si `usage` est absent ou `null`, rien n’est affiché. Aucun compteur pendant le streaming. L’usage n’est pas persisté en base : il disparaît au rechargement de l’historique. Stop et retry en échec ne laissent aucun usage accroché à l’UI.

---

## Endpoints utilisés

Le navigateur préfixe `/api` ; le proxy Vite le retire avant FastAPI.

| Méthode | Route backend | Usage |
| --- | --- | --- |
| `GET` | `/conversations` | Liste (barre latérale) |
| `POST` | `/conversations` | Nouvelle conversation |
| `GET` | `/conversations/{id}/messages` | Historique (user, assistant, note, notifications) |
| `POST` | `/conversations/{id}/notes` | Création d’une note |
| `GET` | `/models` | Catalogue et modèle par défaut |
| `POST` | `/chat` | Message + modèle ; **réponse SSE** (`delta` / `done` / `error` / `[DONE]`), pas un JSON unique |

---

## Tests et vérification

```bash
npm test
npm run lint
npm run build
```

Les tests Vitest couvrent notamment le parseur SSE, `GET /models`, le payload `/chat`, les notes (`POST /notes` sans `/chat`), le Retry, le Stop (`AbortController`) et l’affichage des tokens.

Dernière exécution observée dans ce dépôt :

| Commande | Résultat |
| --- | --- |
| `npm test` | 49 tests passants |
| `npm run lint` | succès |
| `npm run build` | succès (`tsc -b && vite build`) |

---

## Architecture frontend (aperçu)

| Fichier | Rôle |
| --- | --- |
| `src/App.tsx` | État, envoi, retry, Stop, notes, modèles |
| `src/api.ts` | Appels HTTP typés vers `/api` |
| `src/sse.ts` | Parseur SSE + lecture `getReader()` |
| `src/abort.ts` | Détection d’`AbortError` |
| `src/retry.ts` | Mémoire de la requête échouée |
| `src/components/ChatWindow.tsx` | Messages, composer, Arrêter, usage |
| `src/components/NoteComposer.tsx` | Formulaire de note |
| `src/components/ModelSelect.tsx` | Sélecteur de modèle |
| `src/components/ChatRetryBanner.tsx` | Bannière Réessayer |
| `src/components/Sidebar.tsx` | Liste des conversations |

---

## Bonus

| Bonus | Statut |
| --- | --- |
| 1 — Retry après erreur LLM | Réalisé |
| 2 — Stop pendant le streaming (`AbortController`) | Réalisé |
| 3 — Affichage des tokens (`usage` du `done`) | Réalisé |
| 4 — Déploiement sur Render + Vercel | Réalisé |

---

## Sécurité

- La clé `RODIUMAI_API_KEY` n’est **pas** dans le frontend.
- Elle est utilisée uniquement par le backend.
- Le navigateur n’appelle que `/api` (proxy Vite en local).
- Les modèles autorisés sont validés **côté serveur**.
- Aucune secret API ne doit être exposé via une variable `VITE_*`.
