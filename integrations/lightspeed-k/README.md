# Connecteur Cashmatic ↔ Lightspeed Restaurant K-Series

Service Node.js (sans dépendance externe) qui fait dialoguer un monnayeur Cashmatic
(SelfPay, VisualPay, InPay : API REST locale de la machine) avec un établissement
Lightspeed Restaurant K-Series (API « Order and Pay »).

Le caissier choisit un ticket ouvert, le client paie sur le monnayeur, le montant
encaissé est enregistré sur le ticket Lightspeed et confirmé par webhook.

```
Interface caissier ──▶ Connecteur ──▶ Cashmatic (LAN, HTTPS)   StartPayment / ActiveTransaction / LastTransaction
                           │
                           ├────────▶ Lightspeed K-Series       GET ticket, POST /o/op/1/pay
                           ◀──────── Lightspeed webhook         PAYMENT SUCCESS | FAILURE
```

## Flux d'un encaissement

| Étape | Appel | Détail |
|---|---|---|
| 1 | `GET /o/op/1/order/accounts/{id}` | Lecture du ticket, calcul du reste dû (`currentAmount − paidAmount`). |
| 2 | `POST /api/transaction/StartPayment` | Montant en centimes, délai d'insertion, référence unique `CM-…`. |
| 3 | `POST /api/device/ActiveTransaction` | Suivi toutes les 300 ms jusqu'à `operation = idle`. |
| 4 | `POST /api/device/LastTransaction` | Résultat : `inserted`, `dispensed`, `notDispensed`, `end`. Encaissé = inséré − rendu. |
| 5 | `POST /o/op/1/pay` | Paiement sur le ticket avec le moyen de paiement `CASHMATIC` et la référence. |
| 6 | Webhook `type: PAYMENT` | `SUCCESS` → terminé ; `FAILURE` → à traiter manuellement (l'argent est encaissé). |
| 7 | Réconciliation | Sans webhook dans le délai, relecture du ticket : la référence externe doit figurer dans `paymentEntries`. |

États : `CREATED → CASHMATIC_IN_PROGRESS → LIGHTSPEED_PENDING → COMPLETED`,
sorties `CANCELLED` (rien encaissé), `LIGHTSPEED_FAILED`, `LIGHTSPEED_UNCONFIRMED`, `ERROR`.

Règles de sécurité financière :

- La référence externe est unique par encaissement ; Lightspeed refuse un doublon
  (« reference has already been used »), ce qui empêche tout double enregistrement.
- Le montant enregistré sur la caisse ne dépasse jamais le montant demandé, même si la
  machine a conservé plus (monnaie non rendue) : l'écart est signalé dans `anomalies`.
- Un paiement partiel (bouton « Accepter le montant inséré ») enregistre ce qui a été inséré.
- Un seul encaissement à la fois sur la machine.

## Installation

Prérequis : Node.js 20 ou plus récent, accès réseau local à la machine Cashmatic,
URL publique en HTTPS pour recevoir les webhooks Lightspeed (reverse proxy, tunnel…).

```bash
cd integrations/lightspeed-k
cp .env.example .env     # puis compléter
npm start
```

L'interface caissier est servie sur `http://localhost:8080/`.

## Configuration Lightspeed

1. **Client OAuth** : obtenir `client_id` / `client_secret` auprès de Lightspeed
   (portail développeur), avec les scopes `orders-api`, `financial-api` et `offline_access`,
   et enregistrer l'URL de redirection `https://<connecteur>/oauth/callback`.
   Un client « trial » ne fonctionne pas en production et inversement (`LSK_ENV`).
2. **Autorisation** : ouvrir `http://localhost:8080/oauth/start`, se connecter avec le
   compte du restaurateur. Les jetons sont stockés dans `data/state.json` et rafraîchis
   automatiquement (jeton d'accès 25 min, refresh token 40 jours, à usage unique).
3. **Établissement** : `GET /api/businesses` donne le `businessLocationId` à mettre dans `LSK_BUSINESS_LOCATION_ID`.
4. **Moyen de paiement** : créer dans le back-office K-Series un moyen de paiement dédié
   (code `CASHMATIC` par défaut). `GET /api/payment-methods` permet de vérifier le code.
5. **Webhook** : `POST /api/setup/webhook` enregistre le webhook « Order and Pay »
   (`endpointId`, URL publique, Basic Auth si `LSK_WEBHOOK_USER` est renseigné).
   Lightspeed envoie toujours les événements Payment `SUCCESS` et `FAILURE`.

## Configuration Cashmatic

`CASHMATIC_URL` (ex. `https://192.168.1.50:50301`), identifiants d'un utilisateur de la
machine. Le certificat de la machine est auto-signé : `CASHMATIC_TLS_INSECURE=true`
désactive sa vérification pour la machine uniquement, jamais pour Lightspeed.

## API du connecteur

| Méthode | Route | Rôle |
|---|---|---|
| GET | `/api/status` | État Lightspeed (autorisé ?) et Cashmatic (joignable ?). |
| GET | `/api/checks` | Tickets ouverts avec un reste dû. |
| POST | `/api/payments` | `{ accountIdentifier, amount?, tip? }` : lance un encaissement (202). |
| GET | `/api/payments`, `/api/payments/{id}` | Historique et suivi. |
| POST | `/api/payments/{id}/cancel` | Annule sur la machine, l'argent inséré est rendu. |
| POST | `/api/payments/{id}/commit` | Clôture avec le montant inséré (paiement partiel). |
| POST | `/api/payments/{id}/reconcile` | Revérifie le ticket Lightspeed. |
| POST | `/webhooks/lightspeed` | Réception des notifications Lightspeed. |
| GET | `/oauth/start`, `/oauth/callback` | Autorisation OAuth2. |
| POST | `/api/setup/webhook` | Crée (ou met à jour avec `{ "update": true }`) le webhook Lightspeed. |

## Tests

```bash
npm test
```

Les tests lancent un faux Lightspeed et un faux Cashmatic en local et couvrent :
encaissement complet avec rendu de monnaie, annulation, monnaie non rendue, paiement
partiel, refus par la caisse, réconciliation sans webhook, contrôles de montant,
rafraîchissement OAuth, reconnexion Cashmatic, API HTTP et protection du webhook.

## Limites connues (API Lightspeed)

- Pas de remboursement ni d'annulation d'un paiement par l'API : seul l'ajout existe.
- Le paiement transite par une caisse K-Series en ligne (`taskTtlInMs`, minimum 60 s) ;
  sans caisse disponible, Lightspeed renvoie `FAILURE` avec `errors.payment.pos.task_timeout`.
- La caisse ne peut pas déclencher la machine : l'encaissement part de cette interface
  (ou de tout logiciel appelant `POST /api/payments`).
- Les champs Cashmatic (`inserted`, `dispensed`, `notDispensed`, `end`) sont ceux de
  l'API v1.0.0.6 ; à confirmer sur la documentation partenaire pour le firmware visé.
