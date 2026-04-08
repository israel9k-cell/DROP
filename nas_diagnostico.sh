#!/bin/bash
# Diagnóstico de NAS - ejecutar en tu PC local
# Uso: bash nas_diagnostico.sh <IP-del-NAS>

NAS_IP="${1:-192.168.1.230}"

echo "========================================="
echo "  Diagnóstico NAS: $NAS_IP"
echo "========================================="
echo ""

# 1. Ping
echo "[1] Ping al NAS..."
if ping -c 3 -W 2 "$NAS_IP" > /dev/null 2>&1; then
    echo "    ✓ NAS responde a ping - está en red"
else
    echo "    ✗ NAS NO responde a ping"
    echo "    → Puede estar apagado, en otra subred, o ICMP bloqueado"
fi
echo ""

# 2. Puertos comunes del NAS
echo "[2] Escaneando puertos del NAS..."
declare -A PORTS=(
    [5000]="Synology DSM (HTTP)"
    [5001]="Synology DSM (HTTPS)"
    [8080]="QNAP QTS (HTTP)"
    [443]="HTTPS general"
    [80]="HTTP general"
    [22]="SSH"
    [445]="SMB/CIFS (compartir archivos)"
    [139]="NetBIOS"
    [548]="AFP (Mac)"
    [9090]="TrueNAS"
    [8443]="HTTPS alternativo"
)

for PORT in "${!PORTS[@]}"; do
    DESC="${PORTS[$PORT]}"
    if (echo > /dev/tcp/"$NAS_IP"/"$PORT") 2>/dev/null; then
        echo "    ✓ Puerto $PORT abierto - $DESC"
    else
        echo "    ✗ Puerto $PORT cerrado - $DESC"
    fi
done
echo ""

# 3. Intentar acceder a la interfaz web
echo "[3] Intentando acceder a la interfaz web..."
for URL in "http://$NAS_IP:5000" "https://$NAS_IP:5001" "http://$NAS_IP:8080" "http://$NAS_IP:80" "https://$NAS_IP:443" "https://$NAS_IP:9090"; do
    RESP=$(curl -sk --connect-timeout 3 -o /dev/null -w "%{http_code}" "$URL" 2>/dev/null)
    if [ "$RESP" != "000" ]; then
        echo "    ✓ $URL → HTTP $RESP"
    else
        echo "    ✗ $URL → Sin respuesta"
    fi
done
echo ""

# 4. Tailscale
echo "[4] Estado de Tailscale..."
if command -v tailscale &> /dev/null; then
    echo "    Tailscale instalado"
    tailscale status 2>&1 | head -20
    echo ""
    echo "    Intentando acceder al NAS por Tailscale..."
    TS_IP=$(tailscale status 2>/dev/null | grep -i nas | awk '{print $1}')
    if [ -n "$TS_IP" ]; then
        echo "    IP Tailscale del NAS: $TS_IP"
        for URL in "http://$TS_IP:5000" "https://$TS_IP:5001" "http://$TS_IP:8080"; do
            RESP=$(curl -sk --connect-timeout 3 -o /dev/null -w "%{http_code}" "$URL" 2>/dev/null)
            if [ "$RESP" != "000" ]; then
                echo "    ✓ $URL → HTTP $RESP"
            else
                echo "    ✗ $URL → Sin respuesta"
            fi
        done
    else
        echo "    No se encontró un dispositivo 'nas' en Tailscale"
    fi
else
    echo "    ✗ Tailscale no está instalado en este equipo"
fi
echo ""

# 5. DNS local
echo "[5] Resolución DNS..."
for NAME in nas synology qnap diskstation; do
    RESOLVED=$(getent hosts "$NAME" 2>/dev/null | awk '{print $1}')
    if [ -n "$RESOLVED" ]; then
        echo "    ✓ '$NAME' resuelve a $RESOLVED"
    fi
done
echo ""

echo "========================================="
echo "  Diagnóstico completo"
echo "========================================="
echo ""
echo "Si los puertos web (5000/5001/8080) están cerrados pero SSH (22)"
echo "o SMB (445) están abiertos, el servicio web del NAS se cayó."
echo ""
echo "Soluciones comunes:"
echo "  1. Reiniciar el NAS (botón físico)"
echo "  2. Si SSH funciona: ssh admin@$NAS_IP"
echo "     Luego: sudo synoservicectl --restart nginx"
echo "     O:     sudo systemctl restart nginx"
echo "  3. Si nada responde: revisar cable de red / switch"
