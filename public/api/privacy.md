---
title: Politique de confidentialité
description: La présente politique décrit comment ce nœud Nox collecte, utilise et protège vos données personnelles conformément au RGPD, à la loi Informatique et Libertés et au DSA.
version: 1
date: 2026-03-15
---

La présente politique de confidentialité décrit comment ce nœud Nox (« nous », « le nœud », « l'opérateur ») collecte, utilise et protège vos données personnelles conformément au **Règlement (UE) 2016/679 du 27 avril 2016 relatif à la protection des données personnelles (RGPD)**, à la **loi Informatique et Libertés modifiée**, et au **Règlement (UE) 2022/2065 sur les services numériques (DSA)**.

---

## 1. Identité du responsable de traitement

Ce nœud est une instance indépendante du réseau fédéré open source Nox. Il est opéré par un administrateur indépendant dont les coordonnées sont publiées au point de terminaison `/.well-known/nox`.

En tant que **responsable du traitement** au sens de l'article 4 §7 du RGPD, l'opérateur détermine les finalités et moyens des traitements de données mis en œuvre sur ce nœud.

Pour toute question ou exercice de vos droits, contactez l'opérateur à l'adresse publiée dans `/.well-known/nox`.

---

## 2. Données collectées (Art. 13 RGPD)

Conformément à l'article 13 du RGPD, voici les données personnelles collectées lors de votre utilisation du service :

### 2.1 Données de compte

Lors de l'inscription, nous collectons :
- **Nom d'utilisateur** et **pseudonyme**
- **Adresse email** (utilisée pour la vérification du compte et les notifications)
- **Mot de passe** (stocké sous forme de hash bcrypt — jamais en clair)
- **Informations de profil** que vous fournissez volontairement : bio, pronoms, avatar, bannière, liens, tags

### 2.2 Données de session et d'appareil

Lors de la connexion, nous stockons :
- **Tokens de session** (utilisés pour authentifier les requêtes)
- **Adresse IP** et **user-agent** de chaque appareil utilisé pour accéder à votre compte
- **Horodatages de dernière connexion** par appareil

### 2.3 Données d'activité

- **Statut de présence** et texte de statut personnalisé (partagé avec vos abonnés et/ou tous les utilisateurs selon vos paramètres)
- **Relations de suivi** (abonnements et abonnés)
- **Messages** envoyés via la plateforme (stockés dans notre base de données)
- **Activité dans les instances VR** : mondes rejoints, compteurs de joueurs

### 2.4 Données techniques

- **Journaux serveur** (adresses IP, horodatages de requêtes, erreurs) — conservés pour une durée limitée à des fins de sécurité et de débogage (voir section 5)

---

## 3. Bases légales et finalités du traitement (Art. 6 RGPD)

Conformément à l'article 6 du RGPD, chaque traitement repose sur l'une des bases légales suivantes :

| Finalité du traitement | Données concernées | Base légale (Art. 6 RGPD) |
|---|---|---|
| Authentification et gestion du compte | Email, hash mot de passe, tokens de session | **Exécution du contrat** (6.1.b) |
| Affichage du profil | Nom d'utilisateur, pseudonyme, avatar, bio, liens | **Exécution du contrat** (6.1.b) |
| Fonctionnalités sociales | Relations de suivi, statut de présence | **Exécution du contrat** (6.1.b) |
| Coordination des instances VR | Appartenance aux instances, IDs de monde, données relay | **Exécution du contrat** (6.1.b) |
| Sécurité et prévention des abus | Adresses IP, empreintes d'appareils, journaux | **Intérêt légitime** (6.1.f) |
| Notifications par email | Adresse email | **Accord** (6.1.a) ou **exécution du contrat** (6.1.b) |
| Obligations légales (réponse aux injonctions) | Données d'identification, logs de connexion | **Obligation légale** (6.1.c) |

Nous ne vendons **pas** vos données à des tiers. Nous n'utilisons **pas** vos données à des fins publicitaires.

---

## 4. Partage des données dans le réseau fédéré

Ce nœud participe au **réseau fédéré Nox**. Cela implique :

- Votre **profil public** (nom d'utilisateur, pseudonyme, avatar, bio) peut être visible et mis en cache par d'autres nœuds du réseau lorsque vous interagissez avec leurs utilisateurs.
- Votre **statut de présence** peut être partagé avec les nœuds hébergeant vos abonnés, selon vos paramètres de présence.
- **La fédération est conçue sur la base du accord** : vos données de localisation ne sont partagées qu'en fonction de votre mode de présence (`oja`, `ojf`, `online`, etc.).

Nous ne pouvons pas contrôler la manière dont les autres nœuds indépendants stockent ou traitent vos données une fois qu'elles leur ont été transmises par fédération, conformément au principe de responsabilité partagée dans les réseaux décentralisés.

---

## 5. Durées de conservation (Art. 5.1.e RGPD)

Conformément au principe de **limitation de la conservation** posé par l'article 5 §1 point e) du RGPD :

| Catégorie de données | Durée de conservation |
|---|---|
| Données de compte | Durée d'activité du compte. Suppression sur demande ou après **3 ans** d'inactivité |
| Sessions actives | Durée de vie configurée par l'opérateur. Expiration automatique |
| Messages | Jusqu'à suppression par l'auteur ou son interlocuteur |
| Journaux serveur (logs) | Maximum **1 an** conformément à l'article L. 34-1 du CPCE (loi française), puis suppression |
| Données de modération | **1 an** après la résolution du signalement — obligation de conservation pour coopération judiciaire |

Les données d'identification et de connexion (IP, user-agent, timestamps) peuvent être conservées jusqu'à **1 an** à des fins de coopération avec les autorités judiciaires, conformément au droit européen et national applicable.

---

## 6. Vos droits au titre du RGPD (Art. 15 à 22)

En tant que personne concernée résidant dans l'Union européenne, vous disposez des droits suivants :

| Droit | Fondement | Description |
|---|---|---|
| **Accès** | Art. 15 RGPD | Obtenir une copie de toutes les données traitées vous concernant |
| **Rectification** | Art. 16 RGPD | Corriger des données inexactes ou incomplètes |
| **Effacement** (« droit à l'oubli ») | Art. 17 RGPD | Demander la suppression de vos données personnelles |
| **Limitation du traitement** | Art. 18 RGPD | Restreindre temporairement l'utilisation de vos données |
| **Portabilité** | Art. 20 RGPD | Recevoir vos données dans un format structuré et lisible |
| **Opposition** | Art. 21 RGPD | Vous opposer au traitement fondé sur l'intérêt légitime |
| **Retrait du accord** | Art. 7 RGPD | Retirer votre accord à tout moment, sans que cela affecte les traitements antérieurs |

Vous disposez d'un délai de réponse de **1 mois** après réception de votre demande (Art. 12 RGPD), pouvant être prolongé de 2 mois en cas de complexité.

**Droit de réclamation :** Si vous estimez que le traitement de vos données ne respecte pas le RGPD, vous disposez du droit d'introduire une réclamation auprès d'une autorité de contrôle compétente, notamment la **Commission Nationale de l'Informatique et des Libertés (CNIL)** en France : [www.cnil.fr](https://www.cnil.fr), ou l'autorité de protection des données de votre État membre de résidence.

Pour exercer vos droits, contactez l'opérateur aux coordonnées publiées dans `/.well-known/nox`.

---

## 7. Sécurité des données (Art. 32 RGPD)

Conformément à l'article 32 du RGPD, nous mettons en œuvre des mesures techniques et organisationnelles appropriées pour garantir un niveau de sécurité adapté au risque :

- Les mots de passe sont **hachés avec bcrypt** (jamais stockés en clair)
- Les sessions sont **signées cryptographiquement** et expirent automatiquement
- Les communications sont **chiffrées via HTTPS/WSS**
- L'authentification à deux facteurs **(2FA) est disponible**
- L'accès aux données personnelles est **restreint au personnel autorisé**

Aucun système n'est infaillible à 100 %. En cas de violation de données susceptible d'engendrer un risque pour vos droits et libertés, vous serez notifié conformément aux articles 33 et 34 du RGPD (voir section 11).

---

## 8. Cookies et stockage local

Ce service n'utilise **pas** de cookies tiers de traçage publicitaire. L'authentification repose sur des **cookies HTTP-only** définis par ce serveur (cookies strictement nécessaires au fonctionnement du service).

Conformément à l'article 82 de la loi Informatique et Libertés et à la directive 2002/58/CE (directive ePrivacy), les cookies strictement nécessaires ne requièrent **pas** de accord préalable.

---

## 9. Transferts de données hors de l'Union européenne

Les données sont traitées en priorité dans l'Union européenne. Dans le cadre de la fédération, des données publiques peuvent être transmises à des nœuds situés en dehors de l'UE. Ces transferts sont effectués dans le respect des dispositions du **Chapitre V du RGPD** (clauses contractuelles types, décisions d'adéquation de la Commission européenne, ou accord explicite de l'utilisateur).

---

## 10. Protection des données des mineurs

Ce service est réservé aux personnes âgées d'au moins **15 ans** (seuil fixé par l'opérateur). Si la loi de votre pays de résidence impose un âge minimum plus élevé, c'est cette loi qui s'applique (voir [CGU – Section 2](terms.md)).

Si vous estimez qu'un utilisateur n'atteignant pas l'âge minimum requis nous a transmis des données personnelles, contactez immédiatement l'opérateur pour obtenir leur suppression. Ces données seront effacées **sans délai** conformément à l'Art. 17 du RGPD.

---

## 11. Notification des violations de données (Art. 33-34 RGPD)

En cas de violation de données à caractère personnel susceptible d'engendrer un risque pour vos droits et libertés, l'opérateur s'engage à :

- Notifier l'autorité de contrôle compétente **dans les 72 heures** suivant la découverte de la violation (Art. 33 RGPD)
- Vous informer **sans délai injustifié** si la violation présente un risque élevé pour vos droits et libertés (Art. 34 RGPD)

---

## 12. Modifications de la présente politique

Nous pouvons mettre à jour cette politique à tout moment. La date de mise à jour en tête de document reflète la dernière révision. La poursuite de l'utilisation du service après modification vaut acceptation de la nouvelle politique.

En cas de modification substantielle, les utilisateurs seront notifiés par une annonce sur la plateforme ou par email, dans les conditions prévues par l'article 13 du RGPD.

---

## 13. Cadre réglementaire applicable

La présente politique s'inscrit dans le cadre des textes suivants :

### Union européenne et France

- **RGPD** — Règlement (UE) 2016/679 du 27 avril 2016
- **Loi Informatique et Libertés** — Loi n° 78-17 du 6 janvier 1978 modifiée
- **DSA** — Règlement (UE) 2022/2065 sur les services numériques
- **Directive ePrivacy** — Directive 2002/58/CE
- **LCEN** — Loi n° 2004-575 du 21 juin 2004

### Royaume-Uni

- **UK GDPR** — Règlement (UE) 2016/679 tel qu'incorporé dans le droit britannique par le *European Union (Withdrawal) Act 2018*
- **Data Protection Act 2018** — Loi sur la protection des données
- **Online Safety Act 2023** — Loi sur la sécurité en ligne, exigeant notamment des plateformes des mesures de protection renforcées pour les mineurs
- **Age Appropriate Design Code (Children's Code)** — Code ICO sur la conception adaptée aux mineurs (applicable aux services susceptibles d'être utilisés par des enfants)

### États-Unis

- **COPPA** — *Children's Online Privacy Protection Act* (15 U.S.C. § 6501 et s.) : interdit la collecte de données personnelles d'enfants de moins de 13 ans sans accord parental vérifiable
- **CCPA/CPRA** — *California Consumer Privacy Act* et *California Privacy Rights Act* : droits des consommateurs californiens sur leurs données, incluant le droit à l'effacement et à la portabilité
- **KOSA** — *Kids Online Safety Act* (2024) : obligations de protection des mineurs sur les plateformes sociales
- **CAN-SPAM Act** (15 U.S.C. § 7701 et s.) : règles relatives aux communications commerciales par email

### Canada

- **LPRPDE / PIPEDA** — *Loi sur la protection des renseignements personnels et les documents électroniques* : cadre fédéral de protection des données
- **Loi 25 (Québec)** — Loi modernisant des dispositions législatives en matière de protection des renseignements personnels (2021)

### Brésil

- **LGPD** — *Lei Geral de Proteção de Dados Pessoais* (Lei n° 13.709/2018) : loi brésilienne de protection des données, alignée sur le RGPD

### Australie

- **Privacy Act 1988** et *Australian Privacy Principles* (APP) : cadre australien de protection des données personnelles
- **Online Safety Act 2021** : obligations de sécurité en ligne et de signalement des contenus illicites

### Japon

- **APPI** — *Act on the Protection of Personal Information* (個人情報の保護に関する法律), révisée en 2022 : protection des données personnelles des résidents japonais

### Remarque sur l'applicabilité

Le respect des lois étrangères applicables dépend de la localisation des utilisateurs et de l'opérateur. En cas de conflit entre les textes, la règle la plus protectrice pour l'utilisateur prévaut dans la mesure compatible avec le droit applicable à l'opérateur.

---

## 14. Contact

Pour toute question relative à la protection de vos données personnelles, contactez l'opérateur du nœud via les informations publiées à `/.well-known/nox`.
