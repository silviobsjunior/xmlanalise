#!/bin/bash
echo "==========================================="
echo "🔍 DIAGNÓSTICO DO PROJETO xmlAnalise"
echo "==========================================="
echo ""

echo "📂 Diretório atual:"
pwd
echo ""

echo "📋 Lista de arquivos e pastas na raiz:"
ls -la
echo ""

echo "📦 Procurando arquivos de configuração:"
echo "--- package.json (Node.js) ---"
find . -name "package.json" -not -path "*/node_modules/*" 2>/dev/null | head -10
echo ""
echo "--- requirements.txt (Python) ---"
find . -name "requirements.txt" -not -path "*/venv/*" 2>/dev/null | head -10
echo ""
echo "--- Procfile ---"
find . -name "Procfile" 2>/dev/null | head -10
echo ""
echo "--- render.yaml ---"
find . -name "render.yaml" 2>/dev/null | head -10
echo ""

echo "🚀 Procurando arquivos de entrada do backend:"
echo "--- index.js (Node.js) ---"
find . -name "index.js" 2>/dev/null | head -10
echo ""
echo "--- server.js (Node.js alternativo) ---"
find . -name "server.js" 2>/dev/null | head -10
echo ""
echo "--- app.js (Node.js alternativo) ---"
find . -name "app.js" 2>/dev/null | head -10
echo ""
echo "--- main.py (Python FastAPI) ---"
find . -name "main.py" 2>/dev/null | head -10
echo ""
echo "--- app.py (Python alternativo) ---"
find . -name "app.py" 2>/dev/null | head -10
echo ""

echo "📁 Estrutura de pastas (2 níveis):"
find . -maxdepth 2 -type d -not -path "*/\.*" | sort
echo ""

echo "🔐 Verificando arquivos .env (credenciais):"
find . -name ".env" 2>/dev/null | head -5
echo ""

echo "📊 Total de arquivos JSON (exceto node_modules):"
find . -name "*.json" -not -path "*/node_modules/*" 2>/dev/null | wc -l
echo ""

echo "==========================================="
echo "✅ Diagnóstico concluído!"
echo "Copie e cole TODO este resultado aqui."
echo "==========================================="
