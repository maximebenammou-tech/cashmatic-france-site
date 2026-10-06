<?php
/**
 * Formulaire de contact de cashmatic-france.fr
 * Reçoit les demandes des formulaires du site et les envoie par e-mail à CMDF.
 * Aucun secret ici : ce fichier est public (dépôt GitHub du site).
 */

const DESTINATAIRE = 'contact@cashmatic-france.fr';
const EXPEDITEUR   = 'contact@cashmatic-france.fr';
const SITE_HOST    = 'cashmatic-france.fr';
const MAX_PAR_HEURE = 5;       // envois max par adresse IP et par heure
const DELAI_MIN_MS  = 3000;    // un humain ne remplit pas le formulaire en moins de 3 s

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

$erreurs = [];
if (strlen($nom) < 2)      { $erreurs[] = 'nom'; }
if (strlen($commerce) < 2) { $erreurs[] = 'commerce'; }
if (!filter_var($email, FILTER_VALIDATE_EMAIL)) { $erreurs[] = 'email'; }
if ($telephone !== '' && !preg_match('/^[0-9 +().-]{9,40}$/', $telephone)) { $erreurs[] = 'telephone'; }
if ($erreurs) {
    repondre(false, 422, 'Vérifiez les champs : ' . implode(', ', $erreurs) . '.');
}

// Objet : [Site] Demande de devis : Boulangerie Martin (SelfPay)
$pages = ['accueil' => 'Accueil', 'selfpay' => 'SelfPay', 'visualpay' => 'VisualPay', 'partenaires' => 'Partenaires'];
$page_lib = $pages[$page] ?? 'Site';
$type = ($page === 'partenaires') ? 'Demande partenaire' : 'Demande de devis';
$objet = '[Site] ' . $type . ' : ' . $commerce . ' (' . $page_lib . ')';

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
