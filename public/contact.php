<?php
/**
 * Formulaire de contact de cashmatic-france.fr
 * Reçoit les demandes des formulaires du site, les enregistre comme leads dans Odoo
 * et les envoie par e-mail à CMDF.
 * Aucun secret ici : ce fichier est public (dépôt GitHub du site). Les accès Odoo sont
 * lus dans ~/cmdf-odoo.php, un fichier placé hors du dossier public et jamais versionné.
 * Sans ce fichier, ou si Odoo ne répond pas, la demande part quand même par e-mail.
 */

const DESTINATAIRE = 'contact@cashmatic-france.fr';
const EXPEDITEUR   = 'contact@cashmatic-france.fr';
const SITE_HOST    = 'cashmatic-france.fr';
const MAX_PAR_HEURE = 5;       // envois max par adresse IP et par heure
const DELAI_MIN_MS  = 3000;    // un humain ne remplit pas le formulaire en moins de 3 s
const ODOO_CONFIG   = 'cmdf-odoo.php';   // cherché dans le dossier personnel o2switch (à côté de public_html)
const ODOO_TIMEOUT  = 6;       // secondes par appel à Odoo

date_default_timezone_set('Europe/Paris');

$ajax = isset($_SERVER['HTTP_ACCEPT']) && strpos($_SERVER['HTTP_ACCEPT'], 'application/json') !== false;

function repondre($ok, $code, $message = '') {
    global $ajax;
    http_response_code($code);
    if ($ajax) {
        header('Content-Type: application/json; charset=utf-8');
        header('Cache-Control: no-store');
        echo json_encode(['ok' => $ok, 'message' => $message], JSON_UNESCAPED_UNICODE);
    } else {
        // Navigateur sans JavaScript : retour sur la page d'accueil avec un statut
        header('Location: /?contact=' . ($ok ? 'envoye' : 'erreur') . '#contact', true, 303);
    }
    exit;
}

function champ($nom, $max) {
    $v = isset($_POST[$nom]) ? (string) $_POST[$nom] : '';
    $v = trim(str_replace("\0", '', $v));
    if (function_exists('mb_substr')) { $v = mb_substr($v, 0, $max, 'UTF-8'); } else { $v = substr($v, 0, $max); }
    return $v;
}

function une_ligne($v) {
    // Pas de retour à la ligne dans les valeurs qui vont dans les en-têtes ou l'objet
    return trim(preg_replace('/[\r\n\t]+/', ' ', $v));
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    header('Allow: POST');
    repondre(false, 405, 'Méthode non autorisée.');
}

// Les envois doivent venir du site lui-même
$origine = $_SERVER['HTTP_ORIGIN'] ?? ($_SERVER['HTTP_REFERER'] ?? '');
if ($origine !== '') {
    $hote = parse_url($origine, PHP_URL_HOST);
    $hote = $hote ? preg_replace('/^www\./', '', strtolower($hote)) : '';
    if ($hote !== SITE_HOST && $hote !== 'localhost' && $hote !== '127.0.0.1') {
        repondre(false, 403, 'Origine non autorisée.');
    }
}

// Champ piège : invisible pour un humain, rempli par les robots
if (champ('site_web', 200) !== '') {
    repondre(true, 200, 'Merci.');   // on ne dit rien au robot
}

// Délai minimal entre l'affichage et l'envoi (champ ajouté par le JavaScript du site)
$t = champ('t', 20);
if ($t !== '' && ctype_digit($t)) {
    $ecoule = (int) round(microtime(true) * 1000) - (int) $t;
    if ($ecoule >= 0 && $ecoule < DELAI_MIN_MS) {
        repondre(false, 429, 'Envoi trop rapide. Patientez quelques secondes puis réessayez.');
    }
}

// Limite d'envois par adresse IP (stockée hors du dossier public, effacée après 1 h)
$dossier = dirname(__DIR__) . '/contact-data';
if (!is_dir($dossier) && !@mkdir($dossier, 0700, true)) {
    $dossier = sys_get_temp_dir() . '/cmdf-contact';
    @mkdir($dossier, 0700, true);
}
$ip = $_SERVER['REMOTE_ADDR'] ?? '0';
$fichier = $dossier . '/rl-' . hash('sha256', $ip . '|cmdf') . '.json';
$maintenant = time();
$horodatages = [];
if (is_file($fichier)) {
    $lu = json_decode((string) @file_get_contents($fichier), true);
    if (is_array($lu)) {
        $horodatages = array_values(array_filter($lu, function ($x) use ($maintenant) { return is_int($x) && $x > $maintenant - 3600; }));
    }
}
if (count($horodatages) >= MAX_PAR_HEURE) {
    repondre(false, 429, 'Trop de demandes envoyées. Réessayez dans une heure ou appelez-nous au 07 65 74 50 60.');
}
// Ménage des anciens fichiers
foreach ((array) @glob($dossier . '/rl-*.json') as $f) {
    if (is_file($f) && filemtime($f) < $maintenant - 3600) { @unlink($f); }
}

// Champs du formulaire
$nom       = une_ligne(champ('nom', 100));
$commerce  = une_ligne(champ('commerce', 150));
$email     = une_ligne(champ('email', 200));
$telephone = une_ligne(champ('telephone', 40));
$activite  = une_ligne(champ('activite', 100));
$modele    = une_ligne(champ('modele', 100));
$profil    = une_ligne(champ('profil', 100));
$message   = champ('message', 5000);
$page      = une_ligne(champ('page', 40));

// Origine de la demande, ajoutée par le JavaScript du site (aucun cookie) :
// site d'où vient le visiteur et paramètres utm_* du lien qui l'a amené.
$provenance = '';
$p = parse_url(une_ligne(champ('provenance', 300)));
if (!empty($p['host'])) {
    $h = preg_replace('/^www\./', '', strtolower($p['host']));
    if ($h !== SITE_HOST) { $provenance = $h . (isset($p['path']) && $p['path'] !== '/' ? $p['path'] : ''); }
}
$utm = [];
foreach (['source', 'medium', 'campaign'] as $k) {
    $v = une_ligne(champ('utm_' . $k, 100));
    if ($v !== '' && preg_match('/^[\p{L}\p{N} ._\-]+$/u', $v)) { $utm[$k] = $v; }
}

$erreurs = [];
if (strlen($nom) < 2)      { $erreurs[] = 'nom'; }
if (strlen($commerce) < 2) { $erreurs[] = 'commerce'; }
if (!filter_var($email, FILTER_VALIDATE_EMAIL)) { $erreurs[] = 'email'; }
if ($telephone !== '' && !preg_match('/^[0-9 +().-]{9,40}$/', $telephone)) { $erreurs[] = 'telephone'; }
if ($erreurs) {
    repondre(false, 422, 'Vérifiez les champs : ' . implode(', ', $erreurs) . '.');
}

// ---------------------------------------------------------------------------
// Odoo : création du lead (JSON-RPC, clé API lue dans ODOO_CONFIG)
// ---------------------------------------------------------------------------

function odoo_appel(array $cfg, $service, $methode, array $args) {
    $corps = json_encode(['jsonrpc' => '2.0', 'method' => 'call', 'id' => mt_rand(),
        'params' => ['service' => $service, 'method' => $methode, 'args' => $args]]);
    $url = rtrim($cfg['url'], '/') . '/jsonrpc';
    if (function_exists('curl_init')) {
        $c = curl_init($url);
        curl_setopt_array($c, [CURLOPT_POST => true, CURLOPT_POSTFIELDS => $corps, CURLOPT_RETURNTRANSFER => true,
            CURLOPT_HTTPHEADER => ['Content-Type: application/json'], CURLOPT_TIMEOUT => ODOO_TIMEOUT, CURLOPT_CONNECTTIMEOUT => 4]);
        $rep = curl_exec($c);
        $err = curl_error($c);
        curl_close($c);
        if ($rep === false) { throw new RuntimeException('Odoo injoignable : ' . $err); }
    } else {
        $ctx = stream_context_create(['http' => ['method' => 'POST', 'header' => "Content-Type: application/json\r\n",
            'content' => $corps, 'timeout' => ODOO_TIMEOUT, 'ignore_errors' => true]]);
        $rep = @file_get_contents($url, false, $ctx);
        if ($rep === false) { throw new RuntimeException('Odoo injoignable'); }
    }
    $j = json_decode($rep, true);
    if (!is_array($j)) { throw new RuntimeException('Réponse Odoo illisible'); }
    if (isset($j['error'])) {
        $m = $j['error']['data']['message'] ?? ($j['error']['message'] ?? 'erreur');
        throw new RuntimeException('Odoo : ' . $m);
    }
    return $j['result'] ?? null;
}

function odoo_kw(array $cfg, $uid, $modele, $methode, array $args, array $kw = []) {
    return odoo_appel($cfg, 'object', 'execute_kw',
        [$cfg['db'], $uid, $cfg['api_key'], $modele, $methode, $args, (object) $kw]);
}

// Identifiant d'un enregistrement par son nom (tag, source…), créé au besoin
function odoo_id_par_nom(array $cfg, $uid, $modele, $nom, $creer = true) {
    $ids = odoo_kw($cfg, $uid, $modele, 'search', [[['name', '=ilike', $nom]]], ['limit' => 1]);
    if ($ids) { return (int) $ids[0]; }
    return $creer ? (int) odoo_kw($cfg, $uid, $modele, 'create', [['name' => $nom]]) : 0;
}

// Source lisible à partir du site d'où vient le visiteur
function source_depuis_provenance($hote) {
    $regles = ['/(^|\.)google\./' => 'Google', '/(^|\.)(linkedin\.com|lnkd\.in)$/' => 'LinkedIn',
        '/(^|\.)(facebook\.com|fb\.com|fb\.me)$/' => 'Facebook', '/(^|\.)instagram\.com$/' => 'Instagram',
        '/(^|\.)bing\.com$/' => 'Bing', '/(^|\.)youtube\.com$/' => 'YouTube', '/(^|\.)(x\.com|t\.co|twitter\.com)$/' => 'X'];
    foreach ($regles as $motif => $nom) { if (preg_match($motif, $hote)) { return $nom; } }
    return '';
}

function html_lignes(array $paires) {
    $out = '';
    foreach ($paires as $libelle => $valeur) {
        if ($valeur === '' || $valeur === null) { continue; }
        $out .= '<li><b>' . htmlspecialchars($libelle) . '</b> : ' . htmlspecialchars($valeur) . '</li>';
    }
    return '<ul>' . $out . '</ul>';
}

/**
 * Crée le lead dans Odoo, ou ajoute la demande en note sur un lead ouvert du même
 * contact (même e-mail ou même téléphone) pour éviter les doublons.
 * Retourne ['id' => int, 'nouveau' => bool] ; lève une exception en cas d'échec.
 */
function odoo_enregistrer_demande(array $cfg, array $d) {
    $uid = odoo_appel($cfg, 'common', 'login', [$cfg['db'], $cfg['login'], $cfg['api_key']]);
    if (!$uid) { throw new RuntimeException('Odoo : identifiants refusés'); }

    $infos = html_lignes(['Nom' => $d['nom'], $d['libelle_societe'] => $d['commerce'], 'E-mail' => $d['email'],
        'Téléphone' => $d['telephone'], 'Activité' => $d['activite'], 'Profil' => $d['profil'], 'Modèle' => $d['modele']]);
    $message = '<p><b>Message</b><br>' . nl2br(htmlspecialchars($d['message'] !== '' ? $d['message'] : '—')) . '</p>';
    $origine = html_lignes(['Formulaire' => $d['page_lib'], 'Provenance' => $d['provenance'] !== '' ? $d['provenance'] : 'accès direct ou inconnu',
        'Source (utm)' => $d['utm']['source'] ?? '', 'Support (utm)' => $d['utm']['medium'] ?? '', 'Campagne (utm)' => $d['utm']['campaign'] ?? '']);
    $html = '<p>Demande reçue depuis cashmatic-france.fr le ' . htmlspecialchars($d['date']) . '.</p>'
          . $infos . $message . '<p><b>Origine</b></p>' . $origine;

    $tags = [odoo_id_par_nom($cfg, $uid, 'crm.tag', 'Site web')];
    if ($d['partenaire']) { $tags[] = odoo_id_par_nom($cfg, $uid, 'crm.tag', 'Partenaire'); }

    // Doublon : lead ou opportunité ouverte avec le même e-mail ou le même téléphone
    $email_motif = addcslashes($d['email'], '%_\\');   // « _ » et « % » sont des jokers en SQL
    $domaine = [['email_from', '=ilike', $email_motif]];
    $chiffres = preg_replace('/\D/', '', $d['telephone']);
    if (strlen($chiffres) >= 9) {
        $domaine = ['|', ['email_from', '=ilike', $email_motif], ['phone_sanitized', 'like', substr($chiffres, -9)]];
    }
    $existant = odoo_kw($cfg, $uid, 'crm.lead', 'search', [$domaine], ['limit' => 1, 'order' => 'create_date desc']);
    if ($existant) {
        $id = (int) $existant[0];
        odoo_kw($cfg, $uid, 'crm.lead', 'message_post', [[$id]],
            ['body' => '<p><b>Nouvelle demande depuis le site</b></p>' . $html, 'body_is_html' => true,
             'message_type' => 'comment', 'subtype_xmlid' => 'mail.mt_note']);
        odoo_kw($cfg, $uid, 'crm.lead', 'write', [[$id], ['tag_ids' => array_map(function ($t) { return [4, $t]; }, $tags)]]);
        return ['id' => $id, 'nouveau' => false];
    }

    $source = $d['utm']['source'] ?? source_depuis_provenance(explode('/', $d['provenance'])[0]);
    $valeurs = [
        'name' => $d['titre'],
        'contact_name' => $d['nom'],
        'partner_name' => $d['commerce'],
        'email_from' => $d['email'],
        'phone' => $d['telephone'],
        'description' => $html,
        'tag_ids' => [[6, 0, $tags]],
        'medium_id' => odoo_id_par_nom($cfg, $uid, 'utm.medium', $d['utm']['medium'] ?? 'Website'),
    ];
    if ($source !== '') { $valeurs['source_id'] = odoo_id_par_nom($cfg, $uid, 'utm.source', $source); }
    if (isset($d['utm']['campaign'])) {
        $camp = odoo_id_par_nom($cfg, $uid, 'utm.campaign', $d['utm']['campaign'], false);
        if ($camp) { $valeurs['campaign_id'] = $camp; }
    }
    $id = (int) odoo_kw($cfg, $uid, 'crm.lead', 'create', [$valeurs]);
    return ['id' => $id, 'nouveau' => true];
}

// Objet : [Site] Demande de devis : Boulangerie Martin (SelfPay)
$pages = ['accueil' => 'Accueil', 'selfpay' => 'SelfPay', 'visualpay' => 'VisualPay', 'partenaires' => 'Partenaires'];
$page_lib = $pages[$page] ?? 'Site';
$type = ($page === 'partenaires') ? 'Demande partenaire' : 'Demande de devis';
$objet = '[Site] ' . $type . ' : ' . $commerce . ' (' . $page_lib . ')';

// Fichier d'accès Odoo : dossier parent du site, puis dossier personnel du compte
function odoo_chemins_config() {
    $dossiers = [dirname(__DIR__), dirname((string) ($_SERVER['DOCUMENT_ROOT'] ?? ''))];
    if (getenv('HOME')) { $dossiers[] = getenv('HOME'); }
    if (function_exists('posix_getpwuid') && function_exists('posix_geteuid')) {
        $u = @posix_getpwuid(posix_geteuid());
        if (!empty($u['dir'])) { $dossiers[] = $u['dir']; }
    }
    $chemins = [];
    foreach ($dossiers as $d) { if ($d !== '' && $d !== '.' && $d !== '/') { $chemins[] = rtrim($d, '/') . '/' . ODOO_CONFIG; } }
    return array_values(array_unique($chemins));
}

// Enregistrement dans Odoo (avant le mail, pour y indiquer le lead). Jamais bloquant.
$odoo_config = null;
$odoo_chemins = odoo_chemins_config();
foreach ($odoo_chemins as $c) { if (@is_file($c)) { $odoo_config = $c; break; } }
$odoo_ligne = 'Lead Odoo : non configuré (fichier introuvable, cherché dans : ' . implode(', ', $odoo_chemins)
    . (ini_get('open_basedir') ? ' ; open_basedir = ' . ini_get('open_basedir') : '') . ')';
if ($odoo_config !== null) {
    try {
        if (!is_readable($odoo_config)) { throw new RuntimeException('fichier ' . $odoo_config . ' illisible (droits)'); }
        $cfg = include $odoo_config;
        if (!is_array($cfg) || empty($cfg['url']) || empty($cfg['db']) || empty($cfg['login']) || empty($cfg['api_key'])) {
            throw new RuntimeException('fichier de configuration incomplet');
        }
        $produit = in_array($page, ['selfpay', 'visualpay'], true) ? ' ' . $page_lib : '';
        $r = odoo_enregistrer_demande($cfg, [
            'titre' => ($page === 'partenaires' ? 'Partenariat — ' : 'Devis' . $produit . ' — ') . $commerce,
            'nom' => $nom, 'commerce' => $commerce, 'email' => $email, 'telephone' => $telephone,
            'activite' => $activite, 'profil' => $profil, 'modele' => $modele, 'message' => $message,
            'libelle_societe' => ($page === 'partenaires' ? 'Société' : 'Commerce'), 'partenaire' => ($page === 'partenaires'),
            'page_lib' => $page_lib, 'provenance' => $provenance, 'utm' => $utm, 'date' => date('d/m/Y à H:i'),
        ]);
        $lien = rtrim($cfg['url'], '/') . '/web#id=' . $r['id'] . '&model=crm.lead&view_type=form';
        $odoo_ligne = ($r['nouveau'] ? 'Lead Odoo créé : ' : 'Ajouté en note au lead Odoo existant : ') . $lien;
    } catch (Throwable $e) {
        $odoo_ligne = 'Lead Odoo NON créé (' . une_ligne($e->getMessage()) . ') : à saisir à la main';
        error_log('contact.php Odoo : ' . $e->getMessage());
    }
}

$lignes = [
    'Nouvelle demande reçue depuis cashmatic-france.fr',
    '',
    'Nom : ' . $nom,
    ($page === 'partenaires' ? 'Société : ' : 'Commerce : ') . $commerce,
    'E-mail : ' . $email,
    'Téléphone : ' . ($telephone !== '' ? $telephone : '—'),
];
if ($activite !== '') { $lignes[] = 'Activité : ' . $activite; }
if ($profil !== '')   { $lignes[] = 'Profil : ' . $profil; }
if ($modele !== '')   { $lignes[] = 'Modèle : ' . $modele; }
$lignes[] = 'Page : ' . $page_lib;
$lignes[] = 'Provenance : ' . ($provenance !== '' ? $provenance : 'accès direct ou inconnu');
if ($utm) { $lignes[] = 'Campagne : ' . implode(' / ', $utm); }
$lignes[] = $odoo_ligne;
$lignes[] = '';
$lignes[] = 'Message :';
$lignes[] = ($message !== '' ? $message : '—');
$lignes[] = '';
$lignes[] = '—';
$lignes[] = 'Envoyé le ' . date('d/m/Y à H:i') . '. Répondez directement à cet e-mail pour écrire au client.';
$corps = implode("\r\n", $lignes);

$entetes = [
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: 8bit',
    'From: "Site CMDF" <' . EXPEDITEUR . '>',
    'Reply-To: ' . $email,
    'X-Mailer: cashmatic-france.fr',
];
$objet_entete = function_exists('mb_encode_mimeheader') ? mb_encode_mimeheader($objet, 'UTF-8', 'B') : $objet;

$envoye = @mail(DESTINATAIRE, $objet_entete, $corps, implode("\r\n", $entetes), '-f' . EXPEDITEUR);

if (!$envoye) {
    repondre(false, 500, "L'envoi a échoué. Écrivez-nous à contact@cashmatic-france.fr ou appelez le 07 65 74 50 60.");
}

$horodatages[] = $maintenant;
@file_put_contents($fichier, json_encode($horodatages), LOCK_EX);

repondre(true, 200, 'Merci, votre demande est bien partie. Nous vous répondons sous 24 h ouvrées.');
