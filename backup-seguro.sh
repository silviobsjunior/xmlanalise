#!/bin/bash
DATA=$(date +%Y%m%d_%H%M%S)
BACKUP_DIR=~/backups/xmlAnalise
SECURE_DIR=~/secure-credentials/xmlAnalise

mkdir -p $BACKUP_DIR $SECURE_DIR

echo "🛡️  Iniciando backup em $DATA"

# Backup completo
cp -r ~/Projetos/xmlAnalise $BACKUP_DIR/backup-$DATA

# Isolar credenciais
find ~/Projetos/xmlAnalise -name "*.json" | while read f; do
  if [[ "$f" != *"package.json"* ]] && [[ "$f" != *"firebase.json"* ]]; then
    mv "$f" $SECURE_DIR/
  fi
done

# Commit git
cd ~/Projjetos/xmlAnalise
git add .
git commit -m "backup automático $DATA" || true

echo "✅ Backup concluído!"
ls -la $BACKUP_DIR/backup-$DATA | head -5
