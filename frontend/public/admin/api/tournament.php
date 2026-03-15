<?php
// API endpoint for tournament bracket data
// Returns JSON. Uses PHP to fetch players and generate single-elimination bracket.
// Keep existing authentication unchanged; this endpoint is intentionally simple.

header('Content-Type: application/json; charset=utf-8');

$dbHost = getenv('DB_HOST');
$dbUser = getenv('DB_USER');
$dbPass = getenv('DB_PASSWORD');
$dbName = getenv('DB_NAME');

if (!$dbHost || !$dbUser || !$dbName) {
    http_response_code(500);
    echo json_encode(['success' => false, 'message' => 'Database environment variables are not configured']);
    exit;
}

$mysqli = new mysqli($dbHost, $dbUser, $dbPass, $dbName);
if ($mysqli->connect_errno) {
    http_response_code(500);
    echo json_encode(['success' => false, 'message' => 'DB connection failed']);
    exit;
}

// Fetch players table (expects table `players` with columns `id`, `name`)
$players = [];
$res = $mysqli->query('SELECT id, name FROM players');
if ($res) {
    while ($r = $res->fetch_assoc()) {
        $players[] = $r;
    }
    $res->free();
}

// Helper: returns next power of two >= n
function next_power_of_two($n) {
    $p = 1;
    while ($p < $n) $p <<= 1;
    return $p;
}

$action = isset($_REQUEST['action']) ? $_REQUEST['action'] : 'list';

if ($action === 'shuffle') {
    // Shuffle server-side (PHP) for true randomness under backend control
    shuffle($players);

    // If not power of two, pad with null to represent BYEs
    $count = count($players);
    $target = next_power_of_two(max(1, $count));
    $byes = $target - $count;

    // Pad players array with null placeholders for BYEs
    for ($i = 0; $i < $byes; $i++) {
        $players[] = null;
    }

    // Pair sequentially into matches
    $matches = [];
    for ($i = 0; $i < count($players); $i += 2) {
        $p1 = $players[$i];
        $p2 = ($i + 1 < count($players)) ? $players[$i + 1] : null;
        $matches[] = ['p1' => $p1, 'p2' => $p2];
    }

    echo json_encode(['success' => true, 'matches' => $matches, 'count' => $count, 'target' => $target]);
    exit;
}

// Default: return players list
echo json_encode(['success' => true, 'players' => $players]);
exit;

?>
