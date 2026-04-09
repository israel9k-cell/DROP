#!/bin/bash
# Watchdog para nginx - revisa cada 60 segundos y lo reinicia si se cae
# Instalar en el NAS UGREEN DH4300PLUS

LOGFILE="/var/log/nginx_watchdog.log"

while true; do
    if ! systemctl is-active --quiet nginx; then
        echo "$(date) - nginx caído, reiniciando..." >> "$LOGFILE"
        systemctl start nginx
        if systemctl is-active --quiet nginx; then
            echo "$(date) - nginx reiniciado exitosamente" >> "$LOGFILE"
        else
            echo "$(date) - ERROR: no se pudo reiniciar nginx" >> "$LOGFILE"
        fi
    fi
    sleep 60
done
