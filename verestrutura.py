#!/usr/bin/env python3
"""
Script para consultar produtos incluídos no Supabase por período
Uso: python consultar_produtos.py [periodo]
"""

import os
import sys
import json
import csv
from datetime import datetime, timedelta
from supabase import create_client, Client
from dotenv import load_dotenv

# Carregar variáveis de ambiente
load_dotenv()

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_ANON_KEY")

if not SUPABASE_URL or not SUPABASE_KEY:
    print("❌ Erro: SUPABASE_URL e SUPABASE_ANON_KEY não configuradas")
    sys.exit(1)

supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

def parse_periodo(periodo_str):
    """Converte string de período (10m, 1h, 3d) para timedelta"""
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

def consultar_produtos(periodo=None):
    """Consulta produtos no Supabase pelo período"""
    
    periodo_str = formatar_periodo(periodo)
    
    print(f"\n{'='*60}")
    print(f"📊 CONSULTANDO PRODUTOS - Período: {periodo_str}")
    print(f"{'='*60}\n")
    
    try:
        # Consulta SIMPLES: apenas produtos_nfe
        query = supabase.table('produtos_nfe').select('*')
        
        # Aplicar filtro de período se especificado
        if periodo:
            data_corte = datetime.now() - periodo
            data_corte_str = data_corte.isoformat()
            query = query.gte('created_at', data_corte_str)
            print(f"🕐 Produtos criados após: {data_corte_str}")
        
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
        
        # Agrupar por NCM (categoria fiscal)
        por_ncm = {}
        por_descricao = {}
        
        for p in produtos:
            ncm = p.get('ncm', 'SEM_NCM')
            por_ncm[ncm] = por_ncm.get(ncm, 0) + 1
            
            desc = p.get('descricao', 'SEM_DESCRICAO')[:50]
            por_descricao[desc] = por_descricao.get(desc, 0) + 1
        
        # Exibir resultados
        print("📋 TOP 10 NCM (Categorias Fiscais):")
        print("-" * 40)
        for i, (ncm, qtd) in enumerate(sorted(por_ncm.items(), key=lambda x: x[1], reverse=True)[:10], 1):
            print(f"  {i:2}. {ncm}: {qtd} produtos")
        
        print(f"\n📋 TOP 10 PRODUTOS MAIS FREQUENTES:")
        print("-" * 40)
        for i, (desc, qtd) in enumerate(sorted(por_descricao.items(), key=lambda x: x[1], reverse=True)[:10], 1):
            print(f"  {i:2}. {desc[:50]}: {qtd} ocorrências")
        
        # Exibir primeiros 5 produtos em detalhe
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
        
        # Estatísticas por período
        print(f"📈 ESTATÍSTICAS:")
        print("-" * 40)
        print(f"   Total de produtos: {len(produtos)}")
        print(f"   NCMs distintas: {len(por_ncm)}")
        print(f"   Produtos distintos: {len(por_descricao)}")
        
        # Média por período
        if periodo and len(produtos) > 0:
            horas = periodo.total_seconds() / 3600
            if horas < 24:
                media_por_hora = len(produtos) / horas
                print(f"   Média por hora: {media_por_hora:.1f} produtos/hora")
            else:
                dias = periodo.total_seconds() / 86400
                media_por_dia = len(produtos) / dias
                print(f"   Média por dia: {media_por_dia:.1f} produtos/dia")
        
        # Exportar para CSV com todas as colunas
        if len(produtos) > 0:
            csv_file = f"produtos_{periodo_str}.csv"
            
            # Pegar todas as colunas disponíveis
            all_columns = set()
            for p in produtos:
                all_columns.update(p.keys())
            
            # Ordenar colunas para consistência
            columns = sorted(all_columns)
            
            with open(csv_file, 'w', newline='', encoding='utf-8') as f:
                writer = csv.DictWriter(f, fieldnames=columns, extrasaction='ignore')
                writer.writeheader()
                writer.writerows(produtos)
            
            print(f"\n💾 Dados exportados para: {csv_file}")
            print(f"   Total de colunas: {len(columns)}")
        
    except Exception as e:
        print(f"❌ Erro durante a consulta: {e}")

def exportar_json(periodo=None):
    """Exporta produtos para JSON"""
    
    try:
        query = supabase.table('produtos_nfe').select('*')
        
        if periodo:
            data_corte = datetime.now() - periodo
            query = query.gte('created_at', data_corte.isoformat())
        
        response = query.execute()
        produtos = response.data
        
        print(json.dumps(produtos, indent=2, default=str))
        
    except Exception as e:
        print(f"❌ Erro na exportação: {e}")

if __name__ == "__main__":
    exportar = '--json' in sys.argv
    periodo_arg = None
    
    for arg in sys.argv[1:]:
        if arg != '--json':
            periodo_arg = arg
    
    periodo = parse_periodo(periodo_arg) if periodo_arg else None
    
    if exportar:
        exportar_json(periodo)
    else:
        consultar_produtos(periodo)