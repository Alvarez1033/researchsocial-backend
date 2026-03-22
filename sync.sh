#!/bin/bash
# ResearchSocial — Full sync script
# Run this: bash sync.sh

BASE="https://raw.githubusercontent.com/Alvarez1033/researchsocial-backend/main"

echo "📁 Creating directories..."
mkdir -p src/config src/db src/routes src/middleware src/socket
mkdir -p public/js public/admin

echo "⬇️  Downloading all files..."

# Config
curl -sf "$BASE/src/config/roles.js" -o src/config/roles.js && echo "✓ src/config/roles.js"

# DB
curl -sf "$BASE/src/db/pool.js" -o src/db/pool.js && echo "✓ src/db/pool.js"
curl -sf "$BASE/src/db/migrate.js" -o src/db/migrate.js && echo "✓ src/db/migrate.js"
curl -sf "$BASE/src/db/seed.js" -o src/db/seed.js && echo "✓ src/db/seed.js"
curl -sf "$BASE/src/db/analytics.js" -o src/db/analytics.js && echo "✓ src/db/analytics.js"
curl -sf "$BASE/src/db/friends.js" -o src/db/friends.js && echo "✓ src/db/friends.js"
curl -sf "$BASE/src/db/attachments.js" -o src/db/attachments.js && echo "✓ src/db/attachments.js"
curl -sf "$BASE/src/db/roles.js" -o src/db/roles.js && echo "✓ src/db/roles.js"

# Middleware
curl -sf "$BASE/src/middleware/auth.js" -o src/middleware/auth.js && echo "✓ src/middleware/auth.js"
curl -sf "$BASE/src/middleware/analytics.js" -o src/middleware/analytics.js && echo "✓ src/middleware/analytics.js"

# Routes
curl -sf "$BASE/src/routes/auth.js" -o src/routes/auth.js && echo "✓ src/routes/auth.js"
curl -sf "$BASE/src/routes/users.js" -o src/routes/users.js && echo "✓ src/routes/users.js"
curl -sf "$BASE/src/routes/posts.js" -o src/routes/posts.js && echo "✓ src/routes/posts.js"
curl -sf "$BASE/src/routes/messages.js" -o src/routes/messages.js && echo "✓ src/routes/messages.js"
curl -sf "$BASE/src/routes/tags.js" -o src/routes/tags.js && echo "✓ src/routes/tags.js"
curl -sf "$BASE/src/routes/search.js" -o src/routes/search.js && echo "✓ src/routes/search.js"
curl -sf "$BASE/src/routes/attachments.js" -o src/routes/attachments.js && echo "✓ src/routes/attachments.js"
curl -sf "$BASE/src/routes/friends.js" -o src/routes/friends.js && echo "✓ src/routes/friends.js"
curl -sf "$BASE/src/routes/roles.js" -o src/routes/roles.js && echo "✓ src/routes/roles.js"
curl -sf "$BASE/src/routes/admin.js" -o src/routes/admin.js && echo "✓ src/routes/admin.js"
curl -sf "$BASE/src/routes/pages.js" -o src/routes/pages.js && echo "✓ src/routes/pages.js"

# Socket
curl -sf "$BASE/src/socket/index.js" -o src/socket/index.js && echo "✓ src/socket/index.js"

# Server
curl -sf "$BASE/src/server.js" -o src/server.js && echo "✓ src/server.js"

# Public JS
curl -sf "$BASE/public/api.js" -o public/api.js && echo "✓ public/api.js"
curl -sf "$BASE/public/js/post-templates.js" -o public/js/post-templates.js && echo "✓ public/js/post-templates.js"
curl -sf "$BASE/public/js/post-composer.js" -o public/js/post-composer.js && echo "✓ public/js/post-composer.js"

# Public HTML
curl -sf "$BASE/public/index.html" -o public/index.html && echo "✓ public/index.html"
curl -sf "$BASE/public/profile.html" -o public/profile.html && echo "✓ public/profile.html"
curl -sf "$BASE/public/messages.html" -o public/messages.html && echo "✓ public/messages.html"
curl -sf "$BASE/public/notifications.html" -o public/notifications.html && echo "✓ public/notifications.html"
curl -sf "$BASE/public/search.html" -o public/search.html && echo "✓ public/search.html"
curl -sf "$BASE/public/network.html" -o public/network.html && echo "✓ public/network.html"

# Admin panel
curl -sf "$BASE/public/admin/index.html" -o public/admin/index.html && echo "✓ public/admin/index.html"

# Package.json
curl -sf "$BASE/package.json" -o package.json && echo "✓ package.json"

echo ""
echo "🗄️  Running database migrations..."
node src/db/roles.js
node src/db/attachments.js

echo ""
echo "✅ Sync complete! Now run: npm run dev"
