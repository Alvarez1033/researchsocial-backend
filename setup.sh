#!/bin/bash
# ─────────────────────────────────────────────────────────────────
#  ResearchSocial — One-time setup script
#  Run once: bash setup.sh
# ─────────────────────────────────────────────────────────────────
set -e

echo ""
echo "🔬 ResearchSocial Setup"
echo "─────────────────────────────────────────────"

# 1. Install dependencies
echo "📦 Installing dependencies..."
npm install

# 2. Create .env if it doesn't exist
if [ ! -f .env ]; then
  echo "⚙️  Creating .env from template..."
  cp .env.example .env
  echo "✏️  Please edit .env to set your DB_USER if needed."
fi

# 3. Run migrations
echo "🗄️  Running database migrations..."
npm run migrate

# 4. Seed sample data
echo "🌱 Seeding sample data..."
npm run seed

echo ""
echo "✅ Setup complete!"
echo ""
echo "🚀 Start the server:"
echo "   npm run dev"
echo ""
echo "🌐 Then open:"
echo "   App:    http://localhost:3000"
echo "   Admin:  http://localhost:3000/admin"
echo ""
echo "🔑 Admin login:"
echo "   Email:    admin@researchsocial.com"
echo "   Password: admin123"
echo ""
echo "👤 Sample researcher login:"
echo "   Email:    alice@example.com"
echo "   Password: password123"
echo ""
