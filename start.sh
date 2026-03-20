#!/bin/bash

# =============================================================
# start.sh — NFCatalog: Inicia todos os serviços
# =============================================================
# Uso:
#   ./start.sh           → inicia ambos (Node + Python FastAPI)
#   ./start.sh node      → inicia apenas o servidor Node.js
#   ./start.sh python    → inicia apenas a API Python
#   ./start.sh stop      → para todos os processos
# =============================================================

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$SCRIPT_DIR/backend"
VENV_DIR="$SCRIPT_DIR/venv"
PID_FILE="$SCRIPT_DIR/.server_pids"

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

banner() {
    echo ""
    echo -e "${BLUE}╔══════════════════════════════════════════╗${NC}"
    echo -e "${BLUE}║          🚀 NFCatalog - Iniciando        ║${NC}"
    echo -e "${BLUE}╚══════════════════════════════════════════╝${NC}"
    echo ""
}

check_deps() {
    # Node.js
    if ! command -v node &> /dev/null; then
        echo -e "${RED}❌ Node.js não encontrado. Instale via: brew install node${NC}"
        exit 1
    fi

    # npm packages no backend
    if [ ! -d "$BACKEND_DIR/node_modules" ]; then
        echo -e "${YELLOW}⚙️  Instalando dependências Node.js...${NC}"
        cd "$BACKEND_DIR" && npm install
    fi

    # Verifica venv Python
    if [ ! -d "$VENV_DIR" ]; then
        echo -e "${YELLOW}⚙️  Criando ambiente virtual Python...${NC}"
        python3 -m venv "$VENV_DIR"
    fi

    # Instala dependências Python se necessário
    if [ ! -f "$VENV_DIR/lib/python3*/site-packages/uvicorn/__init__.py" ] 2>/dev/null; then
        echo -e "${YELLOW}⚙️  Instalando dependências Python...${NC}"
        "$VENV_DIR/bin/pip" install -q -r "$BACKEND_DIR/requirements.txt"
    fi
}

start_node() {
    echo -e "${GREEN}▶  Iniciando servidor Node.js (porta 3000)...${NC}"
    cd "$BACKEND_DIR"
    node index.js &
    NODE_PID=$!
    echo $NODE_PID >> "$PID_FILE"
    echo -e "${GREEN}   ✅ Node.js rodando (PID: $NODE_PID)${NC}"
    echo -e "${GREEN}   🌐 http://localhost:3000${NC}"
}

start_python() {
    echo -e "${GREEN}▶  Iniciando FastAPI Python (porta 8000)...${NC}"
    cd "$BACKEND_DIR"
    "$VENV_DIR/bin/uvicorn" main:app --host 0.0.0.0 --port 8000 --reload &
    PYTHON_PID=$!
    echo $PYTHON_PID >> "$PID_FILE"
    echo -e "${GREEN}   ✅ FastAPI rodando (PID: $PYTHON_PID)${NC}"
    echo -e "${GREEN}   🌐 http://localhost:8000${NC}"
    echo -e "${GREEN}   📖 Docs: http://localhost:8000/docs${NC}"
}

stop_all() {
    if [ -f "$PID_FILE" ]; then
        echo -e "${YELLOW}⏹  Parando serviços...${NC}"
        while read -r pid; do
            if kill -0 "$pid" 2>/dev/null; then
                kill "$pid" 2>/dev/null && echo -e "   Processo $pid encerrado"
            fi
        done < "$PID_FILE"
        rm -f "$PID_FILE"
        echo -e "${GREEN}✅ Todos os serviços parados.${NC}"
    else
        echo -e "${YELLOW}Nenhum serviço registrado para parar.${NC}"
        # Tenta matar pelos nomes mesmo assim
        pkill -f "node index.js" 2>/dev/null && echo "Node.js encerrado" || true
        pkill -f "uvicorn main:app" 2>/dev/null && echo "FastAPI encerrado" || true
    fi
    exit 0
}

# =============================================================
# MAIN
# =============================================================
MODE="${1:-all}"

case "$MODE" in
    stop)
        stop_all
        ;;
    node)
        banner
        check_deps
        # Para instância anterior se existir
        pkill -f "node index.js" 2>/dev/null || true
        rm -f "$PID_FILE"
        start_node
        echo ""
        echo -e "${BLUE}Pressione Ctrl+C para parar${NC}"
        wait
        ;;
    python)
        banner
        check_deps
        # Para instância anterior se existir
        pkill -f "uvicorn main:app" 2>/dev/null || true
        rm -f "$PID_FILE"
        start_python
        echo ""
        echo -e "${BLUE}Pressione Ctrl+C para parar${NC}"
        wait
        ;;
    all|*)
        banner
        check_deps

        # Para instâncias anteriores
        pkill -f "node index.js" 2>/dev/null || true
        pkill -f "uvicorn main:app" 2>/dev/null || true
        rm -f "$PID_FILE"

        start_node
        echo ""
        sleep 1
        start_python
        echo ""
        echo -e "${BLUE}════════════════════════════════════════════${NC}"
        echo -e "${GREEN}  ✅ NFCatalog está no ar!${NC}"
        echo -e "${BLUE}════════════════════════════════════════════${NC}"
        echo -e "  🖥️  Frontend:  ${GREEN}http://localhost:3000${NC}"
        echo -e "  ⚡ API Lote:  ${GREEN}http://localhost:8000${NC}"
        echo -e "  📖 API Docs:  ${GREEN}http://localhost:8000/docs${NC}"
        echo -e "${BLUE}════════════════════════════════════════════${NC}"
        echo ""
        echo -e "${YELLOW}  Para parar: ./start.sh stop  ou  Ctrl+C${NC}"
        echo ""

        # Trap Ctrl+C para encerrar ambos
        trap 'echo ""; echo "Encerrando serviços..."; stop_all' INT TERM

        wait
        ;;
esac