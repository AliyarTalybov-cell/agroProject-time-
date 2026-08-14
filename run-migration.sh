#!/bin/bash
# Запуск миграции calendar_task_assignees + calendar_task_files + политики Storage для task-attachments
# Требуется: Supabase CLI и привязка проекта (supabase link)

set -e
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
MIGRATION="$SCRIPT_DIR/supabase/migrations/add_calendar_task_assignees_and_files.sql"

if [ ! -f "$MIGRATION" ]; then
  echo "Файл не найден: $MIGRATION"
  exit 1
fi

echo "Выполняю миграцию..."
supabase db execute --file "$MIGRATION"
echo "Готово."
