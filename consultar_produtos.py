#!/usr/bin/env python3
"""
Script para consultar produtos no Supabase
Uso: python consultar_produtos.py [opções] [período]

Modos de uso:
  # Consulta simples por período
  python consultar_produtos.py 10m      # últimos 10 minutos
  python consultar_produtos.py 1h       # última hora
  python consultar_produtos.py 3d       # últimos 3 dias
  python consultar_produtos.py all      # todos os produtos

  # Consulta temporal (agrupada por hora/dia)
  python consultar_produtos.py --temporal 1h    # últimos 1h, agrupado por minuto
  python consultar_produtos.py --temporal 3d    # últimos 3 dias, agrupado por hora
  python consultar_produtos.py --temporal all  # todos, agrupado por dia

  # Exportação
  python consultar_produtos.py 1h --json > produtos.json
  python consultar_produtos.py all --csv        # já gera CSV automaticamente

  # Ajuda
  python consultar_produtos.py --help
"""

import os
import sys
import json
import csv
import argparse
from datetime import datetime, timedelta
from supabase import create_client, Client
from dotenv import load_dotenv

# Carregar variáveis de ambiente
load_dotenv()

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_ANON_KEY")

if not SUPABASE_URL or not SUPABASE_KEY:
    print("❌ Erro: SUPABASE_URL e SUPABASE_ANON_KEY não configuradas")
    print("   Certifique-se de ter um arquivo .env com essas variáveis")
    sys.exit(1)

supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

def parse_periodo(periodo_str):
    """Converte string de período (10m, 1h, 3d, all) para timedelta"""
    if periodo_str == 'all':
        return None
    
    try:
        valor = int(periodo_str[:-1])
        unidade = periodo_str[-1].lower()
        
        if unidade == 'm':
            return timedelta(minutes=valor)
        elif unidade == 'h':
            return timedelta(hours=valor)
        elif unidade == 'd':
            return timedelta(days=valor)
        else:
            raise ValueError(f"Unidade inválida: {unidade}")
    except (ValueError, IndexError):
        print(f"❌ Período inválido: {periodo_str}")
        print("   Use formatos como: 10m, 1h, 3d, 7d ou all")
        sys.exit(1)

def formatar_periodo(periodo):
    """Formata timedelta para string legível"""
    if not periodo:
        return "todos"
    
    if periodo.days > 0:
        return f"{periodo.days}d"
    elif periodo.total_seconds() >= 3600:
        return f"{int(periodo.total_seconds()/3600)}h"
    else:
        return f"{int(periodo.total_seconds()/60)}m"

def agrupar_temporal(produtos, tipo):
    """
    Agrupa produtos por intervalo de tempo
    tipo: 'minuto', 'hora', 'dia', 'mes'
    """
    agrupado = {}
    
    for p in produtos:
        created = p.get('created_at')
        if not created:
            continue
        
        dt = datetime.fromisoformat(created.replace('Z', '+00:00'))
        
        if tipo == 'minuto':
            chave = dt.strftime('%Y-%m-%d %H:%M')
        elif tipo == 'hora':
            chave = dt.strftime('%Y-%m-%d %H:00')
        elif tipo == 'dia':
            chave = dt.strftime('%Y-%m-%d')
        elif tipo == 'mes':
            chave = dt.strftime('%Y-%m')
        else:
            chave = dt.strftime('%Y-%m-%d %H:00')
        
        agrupado[chave] = agrupado.get(chave, 0) + 1
    
    return agrupado

def consultar_simples(periodo=None, exportar_json=False):
    """Consulta simples com estatísticas básicas"""
    
    periodo_str = formatar_periodo(periodo)
    
    print(f"\n{'='*60}")
    print(f"📊 CONSULTANDO PRODUTOS - Período: {periodo_str}")
    print(f"{'='*60}\n")
    
    try:
        query = supabase.table('produtos_nfe').select('*')
        
        if periodo:
            data_corte = datetime.now() - periodo
            query = query.gte('created_at', data_corte.isoformat())
            print(f"🕐 Produtos criados após: {data_corte.strftime('%Y-%m-%d %H:%M:%S')}")
        
        print("🔄 Executando consulta...")
        response = query.execute()
        
        if hasattr(response, 'error') and response.error:
            print(f"❌ Erro na consulta: {response.error}")
            return
        
        produtos = response.data
        print(f"✅ {len(produtos)} produtos encontrados\n")
        
        if not produtos:
            print("📭 Nenhum produto encontrado no período especificado.")
            return
        
        # Estatísticas
        por_ncm = {}
        por_descricao = {}
        
        for p in produtos:
            ncm = p.get('ncm', 'SEM_NCM')
            por_ncm[ncm] = por_ncm.get(ncm, 0) + 1
            
            desc = p.get('descricao', 'SEM_DESCRICAO')[:50]
            por_descricao[desc] = por_descricao.get(desc, 0) + 1
        
        # Top 10 NCM
        print("📋 TOP 10 NCM (Categorias Fiscais):")
        print("-" * 40)
        for i, (ncm, qtd) in enumerate(sorted(por_ncm.items(), key=lambda x: x[1], reverse=True)[:10], 1):
            print(f"  {i:2}. {ncm}: {qtd} produtos")
        
        # Top 10 Produtos
        print(f"\n📋 TOP 10 PRODUTOS MAIS FREQUENTES:")
        print("-" * 40)
        for i, (desc, qtd) in enumerate(sorted(por_descricao.items(), key=lambda x: x[1], reverse=True)[:10], 1):
            print(f"  {i:2}. {desc[:50]}: {qtd} ocorrências")
        
        # Amostra
        print(f"\n📦 AMOSTRA DOS ÚLTIMOS 5 PRODUTOS:")
        print("-" * 60)
        for i, p in enumerate(produtos[:5], 1):
            created = p.get('created_at', 'N/A')
            if created and created != 'N/A':
                created = created.replace('T', ' ').replace('Z', '')[:19]
            
            print(f"  {i}. {p.get('descricao', 'N/A')[:60]}")
            print(f"     📍 Código: {p.get('codigo_barras', 'N/A')}")
            print(f"     📊 NCM: {p.get('ncm', 'N/A')}")
            print(f"     🕐 Criado em: {created}")
            print()
        
        # Estatísticas gerais
        print(f"📈 ESTATÍSTICAS:")
        print("-" * 40)
        print(f"   Total de produtos: {len(produtos)}")
        print(f"   NCMs distintas: {len(por_ncm)}")
        print(f"   Produtos distintos: {len(por_descricao)}")
        
        if periodo and len(produtos) > 0:
            horas = periodo.total_seconds() / 3600
            if horas < 24:
                media_por_hora = len(produtos) / horas
                print(f"   Média por hora: {media_por_hora:.1f} produtos/hora")
            else:
                dias = periodo.total_seconds() / 86400
                media_por_dia = len(produtos) / dias
                print(f"   Média por dia: {media_por_dia:.1f} produtos/dia")
        
        # Exportar CSV
        if len(produtos) > 0:
            csv_file = f"produtos_{periodo_str}.csv"
            all_columns = set()
            for p in produtos:
                all_columns.update(p.keys())
            columns = sorted(all_columns)
            
            with open(csv_file, 'w', newline='', encoding='utf-8') as f:
                writer = csv.DictWriter(f, fieldnames=columns, extrasaction='ignore')
                writer.writeheader()
                writer.writerows(produtos)
            
            print(f"\n💾 Dados exportados para: {csv_file}")
            print(f"   Total de colunas: {len(columns)}")
        
        if exportar_json:
            print(json.dumps(produtos, indent=2, default=str))
            
    except Exception as e:
        print(f"❌ Erro durante a consulta: {e}")

def consultar_temporal(periodo=None, agrupamento=None):
    """Consulta com agrupamento temporal"""
    
    periodo_str = formatar_periodo(periodo)
    
    # Determinar agrupamento automático se não especificado
    if not agrupamento:
        if periodo and periodo.days > 0:
            if periodo.days >= 30:
                agrupamento = 'mes'
            elif periodo.days >= 7:
                agrupamento = 'dia'
            else:
                agrupamento = 'hora'
        else:
            agrupamento = 'hora'
    
    print(f"\n{'='*60}")
    print(f"📊 CONSULTA TEMPORAL - Período: {periodo_str}")
    print(f"📅 Agrupamento: {agrupamento}")
    print(f"{'='*60}\n")
    
    try:
        query = supabase.table('produtos_nfe').select('*')
        
        if periodo:
            data_corte = datetime.now() - periodo
            query = query.gte('created_at', data_corte.isoformat())
            print(f"🕐 Produtos criados após: {data_corte.strftime('%Y-%m-%d %H:%M:%S')}")
        
        print("🔄 Executando consulta...")
        response = query.execute()
        
        if hasattr(response, 'error') and response.error:
            print(f"❌ Erro na consulta: {response.error}")
            return
        
        produtos = response.data
        print(f"✅ {len(produtos)} produtos encontrados\n")
        
        if not produtos:
            print("📭 Nenhum produto encontrado no período especificado.")
            return
        
        # Agrupar por intervalo
        agrupado = agrupar_temporal(produtos, agrupamento)
        
        print(f"📊 DISTRIBUIÇÃO POR {agrupamento.upper()}:")
        print("-" * 40)
        
        for chave in sorted(agrupado.keys()):
            qtd = agrupado[chave]
            barra = '█' * min(int(qtd / max(1, max(agrupado.values())) * 30), 30)
            print(f"  {chave}: {qtd:4} produtos {barra}")
        
        # Estatísticas temporais
        valores = list(agrupado.values())
        if valores:
            print(f"\n📈 ESTATÍSTICAS TEMPORAIS:")
            print("-" * 40)
            print(f"   Média por {agrupamento}: {sum(valores)/len(valores):.1f}")
            print(f"   Máximo: {max(valores)} produtos")
            print(f"   Mínimo: {min(valores)} produtos")
            print(f"   Total de intervalos: {len(agrupado)}")
        
        # Exportar CSV temporal
        csv_file = f"temporal_{periodo_str}_{agrupamento}.csv"
        with open(csv_file, 'w', newline='', encoding='utf-8') as f:
            writer = csv.writer(f)
            writer.writerow(['intervalo', 'quantidade'])
            for chave in sorted(agrupado.keys()):
                writer.writerow([chave, agrupado[chave]])
        
        print(f"\n💾 Dados temporais exportados para: {csv_file}")
        
    except Exception as e:
        print(f"❌ Erro durante a consulta: {e}")

def main():
    parser = argparse.ArgumentParser(
        description='Consulta produtos no Supabase',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Exemplos:
  %(prog)s 10m              # últimos 10 minutos (simples)
  %(prog)s 1h               # última hora (simples)
  %(prog)s 3d               # últimos 3 dias (simples)
  %(prog)s all              # todos os produtos (simples)
  
  %(prog)s --temporal 1h    # última hora, agrupado por minuto
  %(prog)s --temporal 3d    # últimos 3 dias, agrupado por hora
  %(prog)s --temporal all   # todos, agrupado por dia
  %(prog)s --temporal 7d --agrupamento dia  # força agrupamento por dia
  
  %(prog)s 1h --json        # exporta como JSON
        """
    )
    
    parser.add_argument('periodo', nargs='?', default='all',
                        help='Período: 10m, 1h, 3d, 7d, all (padrão: all)')
    parser.add_argument('--temporal', '-t', action='store_true',
                        help='Modo temporal (agrupado por intervalo)')
    parser.add_argument('--agrupamento', '-g', choices=['minuto', 'hora', 'dia', 'mes'],
                        help='Agrupamento para modo temporal (minuto, hora, dia, mes)')
    parser.add_argument('--json', '-j', action='store_true',
                        help='Exportar como JSON (modo simples)')
    
    args = parser.parse_args()
    
    periodo = parse_periodo(args.periodo)
    
    if args.temporal:
        consultar_temporal(periodo, args.agrupamento)
    else:
        consultar_simples(periodo, args.json)

if __name__ == "__main__":
    main()