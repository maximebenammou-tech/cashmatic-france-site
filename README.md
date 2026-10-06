# cashmatic-france.fr

Site de CMDF — Cashmatic Distribution France. Fichiers statiques (HTML, CSS, JS).

- `public/` : le site tel qu'il est servi (copié dans `public_html` chez o2switch).
- `deploy.sh` : lancé toutes les 10 minutes par une tâche Cron cPanel ; met le site à jour quand `main` change, après une sauvegarde de la version en ligne (`~/site-backups`).
