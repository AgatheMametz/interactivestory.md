---
title: Démo histoire
version: "0.1.0"
author: Auteurice
email: hello@example.com
link: https://example.com
start: debut
---

# debut

Tu commences ici. (set: score 0) (set: vip false)

Si tu es VIP, un raccourci apparaît : (if: vip)(vip_node)

Ternaire (plan) : (if: vip = true ; **tu es VIP** ; _pas encore VIP_).

(ifnot: score = 0 ; (score était déjà > 0) ; (premier passage))

Après une visite, (set: score++) ton score vaut une unité de plus. (if: score = 1)(apres_un)

## options
  
[Aller au carrefour](carrefour)

# carrefour

Au carrefour. (set: vip true)

(if: vip)(vip_node)

## options

[Fin](fin)

# vip_node

Raccourci VIP.

## options

[Retour carrefour](carrefour)

# apres_un

Le compteur vient d’être incrémenté.

## options

[Suite](carrefour)

# fin

Fin.

## options
