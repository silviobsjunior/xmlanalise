#!/usr/bin/env python3
"""
processa.py — Importador em lote de XMLs NF-e para o xmlAnalise

Uso:
    python3 processa.py <diretorio> [token] [--perspectiva emitente|revendedor]

Exemplos:
    # Padrão: XMLs onde você é o VENDEDOR (emitente)
    python3 processa.py ../xmls/vendas

    # XMLs onde você é o REVENDEDOR (destinatário que revende)
    python3 processa.py ../xmls/compras --perspectiva revendedor

    # Passando token direto
    python3 processa.py ../xmls/vendas eyJhbGciOiJFUzI1NiIs...

    # Token + perspectiva revendedor
    python3 processa.py ../xmls/compras eyJhbGciOiJFUzI1NiIs... --perspectiva revendedor

O token fica salvo em ~/.xmlanalise_token para reutilização automática.
"""

import sys
import os
import json
import time
import hashlib
import threading
import webbrowser
import urllib.request
import urllib.parse
import urllib.error
from pathlib import Path
from http.server import HTTPServer, BaseHTTPRequestHandler
from datetime import datetime

# ============================================================
# CONFIGURAÇÕES
# ============================================================
API_BASE        = "http://localhost:3000"
TOKEN_FILE      = Path.home() / ".xmlanalise_token"
CACHE_FILE      = Path.home() / ".xmlanalise_cache.json"  # controle de arquivos já processados
PASTA_PROCESSADOS = "PROCESSADOS"  # pasta irmã da raiz: /XMLs/PROCESSADOS/DIVERSOS/...
WORKERS         = 4      # requisições simultâneas
PAUSA_ERRO_S    = 2      # segundos de pausa após erro 500
MAX_TENTATIVAS  = 3      # tentativas por arquivo

# ============================================================
# CORES NO TERMINAL
# ============================================================
class C:
    VERDE   = "\033[92m"
    AMARELO = "\033[93m"
    VERMELHO= "\033[91m"
    AZUL    = "\033[94m"
    CINZA   = "\033[90m"
    RESET   = "\033[0m"
    NEGRITO = "\033[1m"

def ok(msg):    print(f"{C.VERDE}  ✅ {msg}{C.RESET}")
def warn(msg):  print(f"{C.AMARELO}  ⚠️  {msg}{C.RESET}")
def erro(msg):  print(f"{C.VERMELHO}  ❌ {msg}{C.RESET}")
def info(msg):  print(f"{C.AZUL}  ℹ️  {msg}{C.RESET}")
def dim(msg):   print(f"{C.CINZA}     {msg}{C.RESET}")

# ============================================================
# AUTENTICAÇÃO
# ============================================================

def carregar_token_salvo():
    """Lê token salvo em disco e verifica se ainda é válido."""
    if not TOKEN_FILE.exists():
        return None
    try:
        dados = json.loads(TOKEN_FILE.read_text())
        token = dados.get("access_token")
        expira = dados.get("expires_at", 0)
        if token and time.time() < expira - 300:
            return token
        warn("Token salvo está expirado.")
        return None
    except Exception:
        return None


def salvar_token(token, expires_in=3600):
    dados = {
        "access_token": token,
        "expires_at": time.time() + expires_in,
        "salvo_em": datetime.now().isoformat()
    }
    TOKEN_FILE.write_text(json.dumps(dados, indent=2))
    TOKEN_FILE.chmod(0o600)


def obter_config_supabase():
    """Busca SUPABASE_URL e ANON_KEY do backend local."""
    try:
        req = urllib.request.Request(f"{API_BASE}/api/config")
        with urllib.request.urlopen(req, timeout=5) as r:
            return json.loads(r.read())
    except Exception as e:
        erro(f"Não foi possível conectar ao servidor em {API_BASE}")
        erro(f"Detalhes: {e}")
        erro("Certifique-se de que o servidor está rodando com ./start.sh")
        sys.exit(1)


def verificar_token_supabase(token, supabase_url=None, anon_key=None):
    """Verifica se um token é válido usando o backend local."""
    try:
        req = urllib.request.Request(
            f"{API_BASE}/api/test-token",
            headers={"Authorization": f"Bearer {token}"}
        )
        with urllib.request.urlopen(req, timeout=10) as r:
            dados = json.loads(r.read())
            if dados.get("sucesso") and dados.get("usuario"):
                return dados["usuario"].get("email"), dados["usuario"].get("id")
            return None, None
    except Exception:
        return None, None


def instrucoes_token_manual(supabase_url):
    """Mostra instruções para obter o token manualmente pelo browser."""
    print()
    print(f"  {C.NEGRITO}{'='*60}{C.RESET}")
    print(f"  {C.AMARELO}{C.NEGRITO}Como obter seu token de acesso:{C.RESET}")
    print(f"  {'='*60}")
    print()
    print(f"  1. Abra o browser e acesse: {C.AZUL}http://localhost:3000{C.RESET}")
    print(f"  2. Faça login com sua conta Google normalmente")
    print(f"  3. Após o login, abra o DevTools:")
    print(f"     {C.CINZA}Mac: Cmd+Option+I  |  Windows: F12{C.RESET}")
    print(f"  4. Clique na aba {C.NEGRITO}Console{C.RESET}")
    print(f"  5. Cole e execute este comando:")
    print()
    print(f"  {C.VERDE}Object.entries(localStorage)")
    print(f"    .find(([k]) => k.includes('auth-token'))")
    print(f"    ?.[1] && JSON.parse(")
    print(f"      Object.entries(localStorage)")
    print(f"        .find(([k]) => k.includes('auth-token'))[1]")
    print(f"    ).access_token{C.RESET}")
    print()
    print(f"  6. Copie o token exibido (começa com {C.NEGRITO}eyJ...{C.RESET})")
    print(f"  7. Execute o script novamente passando o token:")
    print()
    print(f"  {C.AZUL}python3 processa.py <diretorio> <token>{C.RESET}")
    print()
    print(f"  {C.CINZA}O token ficará salvo e você não precisará repetir isso{C.RESET}")
    print(f"  {C.CINZA}até ele expirar (geralmente 1 hora).{C.RESET}")
    print()


class CallbackHandler(BaseHTTPRequestHandler):
    """Servidor HTTP temporário para capturar o token OAuth do browser."""
    token_recebido = None
    expires_in_recebido = 3600
    evento = threading.Event()

    def do_GET(self):
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.end_headers()
        html = """<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>xmlAnalise — Login</title>
<style>
  body { font-family: system-ui; display:flex; align-items:center;
         justify-content:center; min-height:100vh; margin:0; background:#f5f5f5; }
  .box { background:white; padding:40px; border-radius:16px;
         box-shadow:0 4px 20px rgba(0,0,0,.1); text-align:center;
         max-width:500px; width:90%; }
  h2  { margin-bottom:10px; }
  p   { color:#666; line-height:1.6; }
  .ok  { color:#28a745; }
  .err { color:#dc3545; }
  .spinner { border:3px solid #f3f3f3; border-top:3px solid #667eea;
             border-radius:50%; width:36px; height:36px;
             animation:spin 1s linear infinite; margin:20px auto; }
  @keyframes spin { to { transform:rotate(360deg); } }
  textarea { width:100%; margin-top:12px; padding:8px; font-size:11px;
             border:1px solid #ddd; border-radius:6px; resize:vertical;
             font-family:monospace; }
  button { margin-top:10px; padding:8px 20px; background:#667eea;
           color:white; border:none; border-radius:6px; cursor:pointer; font-size:14px; }
</style></head>
<body><div class="box">
  <div class="spinner" id="spin"></div>
  <h2 id="titulo">Processando login...</h2>
  <p id="msg">Aguarde enquanto enviamos as credenciais para o script.</p>
</div>
<script>
(function(){
  var hash = window.location.hash.substring(1);
  if(!hash) hash = window.location.search.substring(1);
  var p = new URLSearchParams(hash);
  var token = p.get('access_token');
  var exp = parseInt(p.get('expires_in') || '3600');

  function setStatus(titulo, msg, ok) {
    document.getElementById('spin').style.display = 'none';
    var h = document.getElementById('titulo');
    h.className = ok ? 'ok' : 'err';
    h.textContent = titulo;
    document.getElementById('msg').innerHTML = msg;
  }

  if(!token) {
    setStatus('⚠️ Token não encontrado',
      'O login foi feito, mas o token não chegou nesta página.<br><br>' +
      'Volte ao terminal — as instruções para copiar o token manualmente serão exibidas.', false);
    fetch('/noop').catch(()=>{});
    return;
  }

  fetch('/token', {
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body: JSON.stringify({access_token: token, expires_in: exp})
  })
  .then(function(r){
    if(r.ok){
      setStatus('✅ Login realizado!',
        'Pode fechar esta aba.<br>O script continuará automaticamente.', true);
    } else { throw new Error('status ' + r.status); }
  })
  .catch(function(e){
    setStatus('❌ Erro ao enviar token',
      'Token obtido mas não foi possível enviá-lo ao script.<br>' +
      'Copie-o abaixo e passe como argumento:<br>' +
      '<textarea rows="3" readonly>' + token + '</textarea>' +
      '<button onclick="navigator.clipboard.writeText(\'' + token + '\').then(()=>this.textContent=\'Copiado!\')">Copiar</button>',
      false);
  });
})();
</script></body></html>"""
        self.wfile.write(html.encode())

    def do_POST(self):
        if self.path == "/token":
            size = int(self.headers.get("Content-Length", 0))
            corpo = json.loads(self.rfile.read(size))
            CallbackHandler.token_recebido = corpo.get("access_token")
            CallbackHandler.expires_in_recebido = corpo.get("expires_in", 3600)
            self.send_response(200)
            self.end_headers()
            self.wfile.write(b"ok")
            CallbackHandler.evento.set()

    def log_message(self, *args):
        pass


def login_via_browser(supabase_url, anon_key):
    """
    Tenta login OAuth. Se o redirect não chegar no servidor local,
    mostra instruções para o usuário obter o token manualmente.
    """
    print()
    info("Iniciando fluxo de login com Google...")
    info("Uma janela do browser será aberta. Faça login com sua conta Google.")
    print()

    # Reset do evento entre execuções
    CallbackHandler.token_recebido = None
    CallbackHandler.evento.clear()

    # Sobe servidor local na porta 9876
    try:
        servidor = HTTPServer(("127.0.0.1", 9876), CallbackHandler)
    except OSError:
        # Porta ocupada — tenta 9877
        servidor = HTTPServer(("127.0.0.1", 9877), CallbackHandler)

    t = threading.Thread(target=servidor.serve_forever, daemon=True)
    t.start()

    redirect_url = "http://127.0.0.1:9876"

    params = urllib.parse.urlencode({
        "provider": "google",
        "redirect_to": redirect_url,
        "access_type": "offline",
        "prompt": "consent"
    })
    login_url = f"{supabase_url}/auth/v1/authorize?{params}"

    webbrowser.open(login_url)
    info("Aguardando login no browser... (timeout: 120 segundos)")
    info("Se o browser não abrir, acesse manualmente:")
    dim(login_url[:80] + "...")
    print()
    print("Object.entries(localStorage)")
    print("  .find(([k]) => k.includes('auth-token'))")
    print("   ?.[1] && JSON.parse(")
    print("     Object.entries(localStorage)")
    print("       .find(([k]) => k.includes('auth-token'))[1]")
    print("  ).access_token")

    recebido = CallbackHandler.evento.wait(timeout=120)
    servidor.shutdown()

    if recebido and CallbackHandler.token_recebido:
        salvar_token(CallbackHandler.token_recebido, CallbackHandler.expires_in_recebido)
        ok(f"Token obtido e salvo em {TOKEN_FILE}")
        return CallbackHandler.token_recebido

    # Timeout ou falha no redirect — mostra instruções manuais
    warn("O token não foi recebido automaticamente.")
    warn("Isso acontece quando o Supabase redireciona para o frontend em vez do script.")
    instrucoes_token_manual(supabase_url)
    sys.exit(1)


def obter_token(token_argumento=None):
    """Resolve o token a ser usado, em ordem de prioridade."""
    config = obter_config_supabase()
    supabase_url = config["supabaseUrl"]
    anon_key = config["supabaseAnonKey"]

    # 1. Token passado como argumento na linha de comando
    if token_argumento:
        info("Verificando token fornecido como argumento...")
        email, uid = verificar_token_supabase(token_argumento)
        if email:
            ok(f"Token válido para: {email}")
            salvar_token(token_argumento)
            return token_argumento, email
        else:
            erro("Token fornecido é inválido ou expirado.")
            instrucoes_token_manual(supabase_url)
            sys.exit(1)

    # 2. Token salvo em disco
    token = carregar_token_salvo()
    if token:
        email, uid = verificar_token_supabase(token)
        if email:
            ok(f"Usando token salvo para: {email}")
            return token, email
        else:
            warn("Token salvo está inválido. Refazendo login...")

    # 3. Login via browser (com fallback para instruções manuais)
    token = login_via_browser(supabase_url, anon_key)
    time.sleep(1)
    email, uid = verificar_token_supabase(token)
    if not email:
        time.sleep(2)
        email, uid = verificar_token_supabase(token)
    if not email:
        erro("Não foi possível verificar o token após login.")
        instrucoes_token_manual(supabase_url)
        sys.exit(1)
    ok(f"Autenticado como: {email}")
    return token, email


# ============================================================
# CACHE LOCAL DE ARQUIVOS JÁ PROCESSADOS
# ============================================================

def carregar_cache():
    """
    Lê o cache de arquivos já processados.
    Estrutura: { "hash_sha256": {"arquivo": str, "data": str, "tamanho": int} }
    """
    if not CACHE_FILE.exists():
        return {}
    try:
        return json.loads(CACHE_FILE.read_text())
    except Exception:
        warn(f"Cache corrompido em {CACHE_FILE}, será recriado.")
        return {}


def salvar_cache(cache):
    """Persiste o cache em disco."""
    CACHE_FILE.write_text(json.dumps(cache, indent=2, ensure_ascii=False))


def hash_arquivo(caminho):
    """Calcula SHA-256 do conteúdo do arquivo (ignora nome/localização)."""
    h = hashlib.sha256()
    try:
        with open(caminho, "rb") as f:
            while True:
                bloco = f.read(65536)
                if not bloco:
                    break
                h.update(bloco)
        return h.hexdigest()
    except Exception:
        return None


def marcar_processado(cache, caminho, file_hash):
    """Adiciona um arquivo ao cache após sucesso."""
    cache[file_hash] = {
        "arquivo": str(caminho),
        "data": datetime.now().isoformat(),
        "tamanho": caminho.stat().st_size
    }


def filtrar_nao_processados(arquivos, cache):
    """
    Separa os arquivos em dois grupos: já processados e pendentes.
    Retorna (pendentes, ja_processados_count).
    """
    pendentes = []
    ja_processados = 0

    for caminho in arquivos:
        file_hash = hash_arquivo(caminho)
        if file_hash and file_hash in cache:
            ja_processados += 1
        else:
            pendentes.append((caminho, file_hash))

    return pendentes, ja_processados


def limpar_cache():
    """Remove o cache local (--limpar-cache)."""
    if CACHE_FILE.exists():
        CACHE_FILE.unlink()
        ok(f"Cache removido: {CACHE_FILE}")
    else:
        info("Nenhum cache encontrado.")


def status_cache():
    """Exibe estatísticas do cache atual (--status-cache)."""
    cache = carregar_cache()
    if not cache:
        info("Cache vazio — nenhum arquivo processado ainda.")
        return
    print()
    print(f"  {C.NEGRITO}Cache em: {CACHE_FILE}{C.RESET}")
    print(f"  Arquivos registrados: {C.VERDE}{len(cache)}{C.RESET}")
    # Mostra os 5 mais recentes
    recentes = sorted(cache.items(), key=lambda x: x[1].get("data", ""), reverse=True)[:5]
    print(f"  Últimos processados:")
    for h, dados in recentes:
        nome = Path(dados["arquivo"]).name
        data = dados["data"][:19].replace("T", " ")
        print(f"  {C.CINZA}  {data}  {nome}{C.RESET}")
    print()


# ============================================================
# PROCESSAMENTO DOS XMLs
# ============================================================

def listar_xmls(diretorio):
    """
    Varre recursivamente o diretório e retorna lista de arquivos .xml pendentes.

    Exemplo de estrutura:
      raiz informada : /XMLs/DIVERSOS
      pendentes      : /XMLs/DIVERSOS/2024/jan/nota.xml
      processados    : /XMLs/PROCESSADOS/DIVERSOS/2024/jan/nota.xml  (pasta irmã)

    Como PROCESSADOS fica fora da raiz informada, o rglob nunca a encontra.
    """
    raiz = Path(diretorio).resolve()
    if not raiz.exists():
        erro(f"Diretório não encontrado: {diretorio}")
        sys.exit(1)

    arquivos = sorted(raiz.rglob("*.xml")) + sorted(raiz.rglob("*.XML"))

    # Remove duplicatas (*.xml e *.XML podem coincidir em alguns sistemas)
    vistos = set()
    resultado = []
    for a in arquivos:
        if a not in vistos:
            vistos.add(a)
            resultado.append(a)
    return resultado


def mover_para_processados(caminho_xml, diretorio_raiz):
    """
    Move o arquivo para <pai_da_raiz>/PROCESSADOS/<nome_da_raiz>/<caminho_relativo>.
    Exemplo:
      raiz informada : /XMLs/DIVERSOS
      arquivo        : /XMLs/DIVERSOS/2024/janeiro/nota.xml
      destino        : /XMLs/PROCESSADOS/DIVERSOS/2024/janeiro/nota.xml
    Preserva a estrutura de subpastas original.
    Retorna o novo caminho ou None em caso de erro.
    """
    try:
        raiz = Path(diretorio_raiz).resolve()
        # Pasta PROCESSADOS fica no mesmo nível que a raiz informada
        destino_base = raiz.parent / PASTA_PROCESSADOS / raiz.name

        # Caminho relativo do arquivo dentro da raiz
        try:
            relativo = caminho_xml.resolve().relative_to(raiz)
        except ValueError:
            relativo = Path(caminho_xml.name)

        destino = destino_base / relativo
        destino.parent.mkdir(parents=True, exist_ok=True)

        # Se já existe arquivo com mesmo nome no destino, adiciona sufixo de hora
        if destino.exists():
            sufixo = datetime.now().strftime("_%H%M%S")
            destino = destino.with_name(destino.stem + sufixo + destino.suffix)

        caminho_xml.rename(destino)
        return destino
    except Exception as e:
        warn(f"Não foi possível mover {caminho_xml.name}: {e}")
        return None


def enviar_xml(caminho_xml, token, perspectiva='emitente'):
    """
    Envia um arquivo XML para a API e retorna um dict com o resultado.
    Retorna: {"status": "ok"|"duplicado"|"erro", "mensagem": str, "tempo_ms": int}
    """
    inicio = time.time()

    # Lê o arquivo
    try:
        conteudo = caminho_xml.read_bytes()
    except Exception as e:
        return {"status": "erro", "mensagem": f"Erro ao ler arquivo: {e}", "tempo_ms": 0}

    # Monta multipart/form-data manualmente (sem dependências externas)
    boundary = "----xmlanalise" + str(int(time.time() * 1000))

    # Campo perspectiva (emitente ou revendedor)
    campo_perspectiva = (
        f"--{boundary}\r\n"
        f'Content-Disposition: form-data; name="perspectiva"\r\n'
        f"\r\n{perspectiva}\r\n"
    ).encode()

    campo_xml = (
        f"--{boundary}\r\n"
        f'Content-Disposition: form-data; name="xml"; filename="{caminho_xml.name}"\r\n'
        f"Content-Type: text/xml\r\n\r\n"
    ).encode() + conteudo + f"\r\n".encode()

    corpo = campo_perspectiva + campo_xml + f"--{boundary}--\r\n".encode()

    url = f"{API_BASE}/api/processar-xml"

    for tentativa in range(1, MAX_TENTATIVAS + 1):
        try:
            req = urllib.request.Request(
                url,
                data=corpo,
                headers={
                    "Authorization": f"Bearer {token}",
                    "Content-Type": f"multipart/form-data; boundary={boundary}",
                    "Content-Length": str(len(corpo)),
                }
            )
            with urllib.request.urlopen(req, timeout=30) as r:
                resposta = json.loads(r.read())
                tempo_ms = int((time.time() - inicio) * 1000)
                if resposta.get("sucesso"):
                    return {"status": "ok", "mensagem": f"NF-e importada", "tempo_ms": tempo_ms}
                else:
                    return {"status": "erro", "mensagem": resposta.get("erro", "Erro desconhecido"), "tempo_ms": tempo_ms}

        except urllib.error.HTTPError as e:
            tempo_ms = int((time.time() - inicio) * 1000)
            try:
                corpo_erro = json.loads(e.read())
            except Exception:
                corpo_erro = {}

            if e.code == 409:
                # Duplicado — não precisa tentar de novo
                return {"status": "duplicado", "mensagem": "Nota já existe no banco", "tempo_ms": tempo_ms}

            if e.code == 401:
                return {"status": "token_expirado", "mensagem": "Token expirado", "tempo_ms": tempo_ms}

            mensagem = corpo_erro.get("erro", f"HTTP {e.code}")

            if tentativa < MAX_TENTATIVAS:
                time.sleep(PAUSA_ERRO_S)
                continue

            return {"status": "erro", "mensagem": mensagem, "tempo_ms": tempo_ms}

        except Exception as e:
            tempo_ms = int((time.time() - inicio) * 1000)
            if tentativa < MAX_TENTATIVAS:
                time.sleep(PAUSA_ERRO_S)
                continue
            return {"status": "erro", "mensagem": str(e), "tempo_ms": tempo_ms}

    return {"status": "erro", "mensagem": "Máximo de tentativas atingido", "tempo_ms": 0}


def barra_progresso(atual, total, largura=40):
    """Retorna uma barra de progresso ASCII."""
    pct = atual / total if total > 0 else 0
    preenchido = int(largura * pct)
    barra = "█" * preenchido + "░" * (largura - preenchido)
    return f"[{barra}] {atual}/{total} ({pct*100:.1f}%)"


def processar_lote(arquivos_com_hash, token, cache, diretorio_raiz, perspectiva='emitente'):
    """
    Processa todos os arquivos pendentes em sequência.
    Após sucesso ou duplicado, move o arquivo para <raiz>/PROCESSADOS/
    preservando a estrutura de subpastas.
    """
    total = len(arquivos_com_hash)
    contadores = {"ok": 0, "duplicado": 0, "erro": 0, "movidos": 0, "token_expirado": 0}
    erros_detalhes = []
    inicio_geral = time.time()
    cache_modificado = False

    raiz_resolved = Path(diretorio_raiz).resolve()
    raiz_resolved = Path(diretorio_raiz).resolve()
    raiz_resolved = Path(diretorio_raiz).resolve()
    pasta_proc = raiz_resolved.parent / PASTA_PROCESSADOS / raiz_resolved.name
    info(f"Arquivos processados serão movidos para: {pasta_proc}")
    print()
    print(f"{C.NEGRITO}  Processando {total} arquivo(s)...{C.RESET}")
    print()

    for i, (caminho, file_hash) in enumerate(arquivos_com_hash, 1):
        progresso = barra_progresso(i - 1, total)
        print(f"\r  {progresso}  {caminho.name[:40]:<40}", end="", flush=True)

        resultado = enviar_xml(caminho, token, perspectiva)
        status = resultado["status"]
        tempo = resultado["tempo_ms"]

        contadores[status] = contadores.get(status, 0) + 1

        if status == "token_expirado":
            print()
            erro("Token expirado durante o processamento.")
            if cache_modificado:
                salvar_cache(cache)
            info(f"Progresso: {contadores['ok']} importados, {contadores['movidos']} movidos.")
            info("Execute novamente — o login será solicitado.")
            info("Os arquivos já movidos para PROCESSADOS não serão reprocessados.")
            TOKEN_FILE.unlink(missing_ok=True)
            sys.exit(1)

        if status in ("ok", "duplicado"):
            # Move o arquivo para a pasta PROCESSADOS
            novo_caminho = mover_para_processados(caminho, diretorio_raiz)
            if novo_caminho:
                contadores["movidos"] += 1
                # Atualiza o caminho no cache para o novo local
                if file_hash:
                    cache[file_hash] = {
                        "arquivo": str(novo_caminho),
                        "data": datetime.now().isoformat(),
                        "tamanho": novo_caminho.stat().st_size if novo_caminho.exists() else 0
                    }
                    cache_modificado = True

            # Salva cache a cada 10 arquivos
            if cache_modificado and i % 10 == 0:
                salvar_cache(cache)

        if status == "erro":
            erros_detalhes.append((caminho, resultado["mensagem"]))

        icone = {"ok": "✅", "duplicado": "⚠️ ", "erro": "❌"}.get(status, "❓")
        cor = {"ok": C.VERDE, "duplicado": C.AMARELO, "erro": C.VERMELHO}.get(status, C.RESET)
        print(f"\r  {cor}{icone} [{i:>{len(str(total))}}/{total}] {caminho.name:<45} {tempo:>5}ms{C.RESET}")

    if cache_modificado:
        salvar_cache(cache)

    print(f"  {barra_progresso(total, total)}")
    print()

    elapsed = time.time() - inicio_geral
    media = (elapsed / total * 1000) if total > 0 else 0

    print(f"{C.NEGRITO}  {'='*60}{C.RESET}")
    print(f"{C.NEGRITO}  RELATÓRIO FINAL{C.RESET}")
    print(f"  {'='*60}")
    print(f"  {C.VERDE}✅ Importados com sucesso : {contadores['ok']:>6}{C.RESET}")
    print(f"  {C.AMARELO}⚠️  Duplicados (movidos)   : {contadores['duplicado']:>6}{C.RESET}")
    print(f"  {C.VERMELHO}❌ Erros (permanecem)     : {contadores['erro']:>6}{C.RESET}")
    print(f"  {C.AZUL}📁 Movidos p/ PROCESSADOS : {contadores['movidos']:>6}{C.RESET}")
    print(f"  {'─'*40}")
    print(f"     Total processado      : {total:>6}")
    print(f"     Tempo total           : {elapsed:.1f}s")
    print(f"     Média por arquivo     : {media:.0f}ms")
    print(f"  {'='*60}")

    if erros_detalhes:
        print()
        print(f"{C.VERMELHO}{C.NEGRITO}  Arquivos com erro (permanecem na pasta original):{C.RESET}")
        for caminho, msg in erros_detalhes[:20]:
            print(f"  {C.VERMELHO}  • {caminho.name}: {msg}{C.RESET}")
        if len(erros_detalhes) > 20:
            print(f"  {C.VERMELHO}  ... e mais {len(erros_detalhes) - 20} arquivo(s){C.RESET}")

        log_path = Path(f"erros_importacao_{datetime.now().strftime('%Y%m%d_%H%M%S')}.txt")
        with open(log_path, "w") as f:
            f.write(f"Log de erros — {datetime.now().isoformat()}\n")
            f.write(f"Diretório: {diretorio_raiz}\n\n")
            for caminho, msg in erros_detalhes:
                f.write(f"{caminho}\t{msg}\n")
        print()
        info(f"Log de erros salvo em: {log_path}")
        info("Arquivos com erro permanecem na pasta e serão tentados novamente.")

    print()
    return contadores


# ============================================================
# MAIN
# ============================================================

def main():
    print()
    print(f"{C.NEGRITO}{C.AZUL}  ╔══════════════════════════════════════════╗{C.RESET}")
    print(f"{C.NEGRITO}{C.AZUL}  ║   xmlAnalise — Importador em Lote       ║{C.RESET}")
    print(f"{C.NEGRITO}{C.AZUL}  ╚══════════════════════════════════════════╝{C.RESET}")
    print()

    # Comandos utilitários (sem precisar de servidor ou token)
    if len(sys.argv) == 2 and sys.argv[1] == "--status-cache":
        status_cache()
        sys.exit(0)

    if len(sys.argv) == 2 and sys.argv[1] == "--limpar-cache":
        limpar_cache()
        sys.exit(0)

    if len(sys.argv) == 2 and sys.argv[1] == "--ajuda":
        print(f"  Uso:")
        print(f"    python3 processa.py <diretorio> [token] [--perspectiva emitente|revendedor]")
        print()
        print(f"  Perspectiva (padrão: emitente):")
        print(f"    emitente    Você é o VENDEDOR — emitente dos XMLs aparece nas buscas")
        print(f"    revendedor  Você é o REVENDEDOR — destinatário dos XMLs aparece nas buscas")
        print()
        print(f"  Opções:")
        print(f"    --perspectiva    Define a perspectiva do importador")
        print(f"    --status-cache   Mostra quantos arquivos já foram processados")
        print(f"    --limpar-cache   Apaga o cache (força reprocessamento de tudo)")
        print(f"    --ajuda          Mostra esta mensagem")
        print()
        print(f"  Exemplos:")
        print(f"    python3 processa.py ../xmls/vendas")
        print(f"    python3 processa.py ../xmls/compras --perspectiva revendedor")
        print(f"    python3 processa.py ../xmls/vendas eyJhbGciOiJFUzI1NiIs...")
        print(f"    python3 processa.py --status-cache")
        print()
        print(f"  Cache salvo em: {CACHE_FILE}")
        print(f"  Token salvo em: {TOKEN_FILE}")
        print()
        sys.exit(0)

    if len(sys.argv) < 2:
        print(f"  Uso: python3 processa.py <diretorio> [token_supabase]")
        print(f"       python3 processa.py --ajuda")
        print()
        sys.exit(1)

    # Extrai --perspectiva dos argumentos (pode vir em qualquer posição após o diretório)
    args_restantes = sys.argv[2:]
    perspectiva = 'emitente'
    token_arg = None
    i = 0
    while i < len(args_restantes):
        if args_restantes[i] == '--perspectiva' and i + 1 < len(args_restantes):
            perspectiva = args_restantes[i + 1]
            if perspectiva not in ('emitente', 'revendedor'):
                erro(f"Perspectiva inválida: '{perspectiva}'. Use 'emitente' ou 'revendedor'.")
                sys.exit(1)
            i += 2
        elif not args_restantes[i].startswith('--'):
            token_arg = args_restantes[i]
            i += 1
        else:
            i += 1

    diretorio = sys.argv[1]

    # Verifica servidor
    info(f"Verificando servidor em {API_BASE}...")
    try:
        urllib.request.urlopen(f"{API_BASE}/api/health", timeout=5)
        ok("Servidor disponível.")
    except Exception:
        erro(f"Servidor não responde em {API_BASE}")
        erro("Certifique-se de que o servidor está rodando com ./start.sh")
        sys.exit(1)

    # Autenticação
    token, email = obter_token(token_arg)
    print()
    info(f"Usuário autenticado: {C.NEGRITO}{email}{C.RESET}")
    perspectiva_label = "🟢 VENDEDOR (emitente)" if perspectiva == 'emitente' else "🟠 REVENDEDOR (destinatário)"
    info(f"Perspectiva: {C.NEGRITO}{perspectiva_label}{C.RESET}")

    # Lista todos os XMLs
    info(f"Varrendo diretório: {diretorio}")
    todos_arquivos = listar_xmls(diretorio)

    if not todos_arquivos:
        warn(f"Nenhum arquivo .xml encontrado em: {diretorio}")
        sys.exit(0)

    info(f"Encontrados {len(todos_arquivos)} arquivo(s) XML no total.")

    # Filtra os já processados usando o cache
    cache = carregar_cache()
    pendentes, ja_processados = filtrar_nao_processados(todos_arquivos, cache)

    if ja_processados > 0:
        ok(f"{ja_processados} arquivo(s) já processados anteriormente — ignorados.")
        info(f"Cache em: {CACHE_FILE}")

    if not pendentes:
        print()
        ok("Todos os arquivos já foram processados! Nada a fazer.")
        info("Use --limpar-cache para forçar o reprocessamento de tudo.")
        sys.exit(0)

    print()
    ok(f"{len(pendentes)} arquivo(s) pendente(s) para importar.")
    print()

    # Confirmação se mais de 100 arquivos pendentes
    if len(pendentes) > 100:
        print(f"  {C.AMARELO}Você está prestes a importar {len(pendentes)} arquivos.{C.RESET}")
        resposta = input("  Confirma? [s/N]: ").strip().lower()
        if resposta not in ("s", "sim", "y", "yes"):
            info("Operação cancelada pelo usuário.")
            sys.exit(0)
        print()

    # Processa apenas os pendentes
    processar_lote(pendentes, token, cache, diretorio, perspectiva)


if __name__ == "__main__":
    main()