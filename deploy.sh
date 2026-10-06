#!/bin/sh
# Déploiement automatique de cashmatic-france.fr sur o2switch.
# Lancé par une tâche Cron cPanel : récupère la dernière version du dépôt
# et met à jour public_html uniquement si quelque chose a changé.
set -e
REPO="$HOME/site-src"
WEB="$HOME/public_html"
cd "$REPO"
git fetch -q origin main
NEW=$(git rev-parse origin/main)
OLD=$(cat "$HOME/.site-deployed" 2>/dev/null || echo none)
[ "$NEW" = "$OLD" ] && exit 0
git reset -q --hard origin/main
# Sauvegarde de la version en ligne avant remplacement (garde les 5 dernières)
mkdir -p "$HOME/site-backups"
tar -czf "$HOME/site-backups/public_html-$(date +%Y%m%d-%H%M%S).tar.gz" -C "$WEB" . 2>/dev/null || true
ls -1t "$HOME"/site-backups/*.tar.gz 2>/dev/null | tail -n +6 | xargs -r rm -f
# Copie du site ; .well-known (certificat SSL) et cgi-bin ne sont jamais touchés
if command -v rsync >/dev/null 2>&1; then
  rsync -a --delete --exclude '.well-known' --exclude 'cgi-bin' "$REPO/public/" "$WEB/"
else
  find "$WEB" -mindepth 1 -maxdepth 1 ! -name '.well-known' ! -name 'cgi-bin' -exec rm -rf {} +
  cp -a "$REPO/public/." "$WEB/"
fi
echo "$NEW" > "$HOME/.site-deployed"
echo "$(date '+%F %T') déployé $NEW"
