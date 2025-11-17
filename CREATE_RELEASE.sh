#!/bin/bash
# Script per creare la release v1.2.0

echo "🏷️  Creazione Release v1.2.0..."

# Assicurati di essere sul branch principale
echo "📥 Fetch delle ultime modifiche..."
git fetch origin

# Checkout al branch principale (prova main, poi master)
if git show-ref --verify --quiet refs/remotes/origin/main; then
    echo "✅ Checkout a main..."
    git checkout main
    git pull origin main
elif git show-ref --verify --quiet refs/remotes/origin/master; then
    echo "✅ Checkout a master..."
    git checkout master
    git pull origin master
else
    echo "❌ Branch principale non trovato. Usa l'interfaccia GitHub."
    exit 1
fi

# Crea il tag
echo "🏷️  Creazione tag v1.2.0..."
git tag -a v1.2.0 -m "Release v1.2.0 - Critical Security Update

⚠️ CRITICAL SECURITY FIXES

Security Fixes:
- Fixed Path Traversal Vulnerability (CRITICAL)
- Fixed Template Rendering Crash (CRITICAL)

Bug Fixes:
- HTTP Status Code 404 (HIGH)
- Race Condition File Access (HIGH)
- File Extension Extraction (HIGH)
- Directory Read Errors (MEDIUM)
- Content-Disposition Header (MEDIUM)
- Code Quality & XSS Protection

Statistics:
- Security vulnerabilities: 2 critical fixed
- Bugs fixed: 6
- Tests: 71 passing
- Documentation: 2000+ lines added"

# Push del tag
echo "📤 Push del tag a GitHub..."
git push origin v1.2.0

echo "✅ Tag creato! Ora vai su GitHub per creare la release:"
echo "   https://github.com/italopaesano/koa-classic-server/releases/new?tag=v1.2.0"
