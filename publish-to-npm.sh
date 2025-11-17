#!/bin/bash
# Script per pubblicare koa-classic-server v1.2.0 su npm

set -e  # Exit on error

echo "📦 Publishing koa-classic-server v1.2.0 to npm"
echo ""

# Verifica login
echo "🔐 Verifying npm login..."
if ! npm whoami > /dev/null 2>&1; then
    echo "❌ Not logged in to npm. Please run: npm login"
    exit 1
fi

echo "✅ Logged in as: $(npm whoami)"
echo ""

# Verifica versione
echo "📋 Package info:"
echo "   Name: $(node -p "require('./package.json').name")"
echo "   Version: $(node -p "require('./package.json').version")"
echo ""

# Verifica che non ci siano modifiche non committate
if [ -n "$(git status --porcelain)" ]; then
    echo "⚠️  Warning: You have uncommitted changes"
    git status --short
    read -p "Continue anyway? (y/N) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        exit 1
    fi
fi

# Dry run per vedere cosa verrà pubblicato
echo "🔍 Files that will be published:"
npm pack --dry-run | tail -20
echo ""

# Chiedi conferma
read -p "🚀 Publish to npm? (y/N) " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "❌ Publish cancelled"
    exit 0
fi

# Pubblica
echo "📤 Publishing to npm..."
npm publish

if [ $? -eq 0 ]; then
    echo ""
    echo "✅ Successfully published koa-classic-server@1.2.0!"
    echo ""
    echo "🔗 View on npm: https://www.npmjs.com/package/koa-classic-server"
    echo ""
    echo "📝 Users can now install with:"
    echo "   npm install koa-classic-server@1.2.0"
    echo "   npm install koa-classic-server@latest"
else
    echo "❌ Publish failed"
    exit 1
fi
