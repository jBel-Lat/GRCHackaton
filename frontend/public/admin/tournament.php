<?php
// Tournament Game page
// Simple PHP + MySQL implementation that lists players and shuffles them into a bracket
// Use environment variables instead of hardcoded credentials.
$dbHost = getenv('DB_HOST');
$dbUser = getenv('DB_USER');
$dbPass = getenv('DB_PASSWORD');
$dbName = getenv('DB_NAME');

if (!$dbHost || !$dbUser || !$dbName) {
    die('Database environment variables are not configured.');
}

// Connect to MySQL
$mysqli = new mysqli($dbHost, $dbUser, $dbPass, $dbName);
if ($mysqli->connect_errno) {
    die('Failed to connect to MySQL: ' . $mysqli->connect_error);
}

// Fetch players
$players = [];
$result = $mysqli->query('SELECT id, name FROM players ORDER BY id');
if ($result) {
    while ($row = $result->fetch_assoc()) {
        $players[] = $row;
    }
    $result->free();
}

$matches = [];
$message = '';

// Handle shuffle request (POST)
if ($_SERVER['REQUEST_METHOD'] === 'POST' && isset($_POST['action']) && $_POST['action'] === 'shuffle') {
    // Shuffle players array randomly
    shuffle($players);

    // Pair players into matches; if odd number, last gets a BYE
    $count = count($players);
    for ($i = 0; $i < $count; $i += 2) {
        $p1 = $players[$i];
        $p2 = ($i + 1 < $count) ? $players[$i + 1] : null;
        $matches[] = ['p1' => $p1, 'p2' => $p2];
    }

    $message = 'Bracket shuffled at ' . date('Y-m-d H:i:s');
}

?>
<!doctype html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Tournament - Admin</title>
    <link rel="stylesheet" href="/css/shared.css">
    <link rel="stylesheet" href="/css/admin.css">
    <style>
        /* Simple bracket layout styles */
        .players-table { width:100%; border-collapse: collapse; margin-bottom: 16px; }
        .players-table th, .players-table td { padding:8px; border:1px solid #e2e2e2; }
        .bracket { display:flex; flex-direction:column; gap:8px; }
        .match { background:#fff; padding:10px; border-radius:6px; box-shadow:0 2px 6px rgba(0,0,0,0.06); display:flex; justify-content:space-between; }
        .bye { color:#888; font-style:italic; }
        .tile-card { display:flex; align-items:center; gap:8px; padding:8px 12px; background:#fff; border-radius:8px; text-decoration:none; color:inherit; box-shadow:0 2px 8px rgba(0,0,0,0.06); }
    </style>
</head>
<body>
    <div class="container">
        <aside class="sidebar">
            <div class="sidebar-header">
                <h2>Admin Panel</h2>
                <div id="userDisplay" class="user-display"></div>
                <button id="logoutBtn" class="logout-btn">Logout</button>
            </div>
            <nav class="sidebar-nav">
                <div class="nav-item-group">
                    <a class="nav-item" href="/admin/dashboard.html">📋 Events</a>
                </div>
                <div class="nav-item-group">
                    <a class="nav-item" href="/admin/dashboard.html#panelists">👥 Manage Panelists</a>
                </div>
                <div class="nav-item-group">
                    <a class="nav-item active" href="/admin/tournament.php">🏆 Tournament Game</a>
                </div>
            </nav>
        </aside>

        <main class="main-content">
            <div class="section-header">
                <h1>Tournament Game</h1>
            </div>

            <section class="content-section active">
                <div class="section-body">
                    <?php if ($message): ?>
                        <div class="empty-state"><p><?php echo htmlspecialchars($message); ?></p></div>
                    <?php endif; ?>

                    <h2>Players</h2>
                    <table class="players-table">
                        <thead>
                            <tr><th>ID</th><th>Name</th></tr>
                        </thead>
                        <tbody>
                            <?php foreach ($players as $p): ?>
                                <tr>
                                    <td><?php echo (int)$p['id']; ?></td>
                                    <td><?php echo htmlspecialchars($p['name']); ?></td>
                                </tr>
                            <?php endforeach; ?>
                        </tbody>
                    </table>

                    <form method="post">
                        <input type="hidden" name="action" value="shuffle">
                        <button type="submit" class="btn btn-primary">Shuffle Bracket</button>
                    </form>

                    <?php if (!empty($matches)): ?>
                        <h2 style="margin-top:16px;">Bracket</h2>
                        <div class="bracket">
                            <?php foreach ($matches as $m): ?>
                                <div class="match">
                                    <div><?php echo htmlspecialchars($m['p1']['name']); ?> (ID: <?php echo (int)$m['p1']['id']; ?>)</div>
                                    <div>vs</div>
                                    <div>
                                        <?php if ($m['p2']): ?>
                                            <?php echo htmlspecialchars($m['p2']['name']); ?> (ID: <?php echo (int)$m['p2']['id']; ?>)
                                        <?php else: ?>
                                            <span class="bye">BYE</span>
                                        <?php endif; ?>
                                    </div>
                                </div>
                            <?php endforeach; ?>
                        </div>
                    <?php endif; ?>
                </div>
            </section>

        </main>
    </div>
</body>
</html>
