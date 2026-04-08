# Diagnóstico de NAS - ejecutar en PowerShell (Windows)
# Uso: .\nas_diagnostico.ps1

$NAS_IP = "192.168.1.230"

Write-Host "=========================================" -ForegroundColor Cyan
Write-Host "  Diagnóstico NAS: $NAS_IP" -ForegroundColor Cyan
Write-Host "=========================================" -ForegroundColor Cyan
Write-Host ""

# 1. Ping
Write-Host "[1] Ping al NAS..." -ForegroundColor Yellow
if (Test-Connection -ComputerName $NAS_IP -Count 3 -Quiet) {
    Write-Host "    OK - NAS responde a ping" -ForegroundColor Green
} else {
    Write-Host "    FALLO - NAS NO responde a ping" -ForegroundColor Red
}
Write-Host ""

# 2. Puertos comunes
Write-Host "[2] Escaneando puertos..." -ForegroundColor Yellow
$ports = @{
    5000 = "Synology DSM (HTTP)"
    5001 = "Synology DSM (HTTPS)"
    8080 = "QNAP QTS (HTTP)"
    443  = "HTTPS general"
    80   = "HTTP general"
    22   = "SSH"
    445  = "SMB (compartir archivos)"
    139  = "NetBIOS"
    9090 = "TrueNAS"
}

foreach ($port in $ports.Keys | Sort-Object) {
    $desc = $ports[$port]
    $tcp = New-Object System.Net.Sockets.TcpClient
    try {
        $tcp.ConnectAsync($NAS_IP, $port).Wait(2000) | Out-Null
        if ($tcp.Connected) {
            Write-Host "    ABIERTO  - Puerto $port - $desc" -ForegroundColor Green
        } else {
            Write-Host "    CERRADO  - Puerto $port - $desc" -ForegroundColor Red
        }
    } catch {
        Write-Host "    CERRADO  - Puerto $port - $desc" -ForegroundColor Red
    } finally {
        $tcp.Close()
    }
}
Write-Host ""

# 3. Intentar interfaz web
Write-Host "[3] Probando interfaz web..." -ForegroundColor Yellow
$urls = @(
    "http://${NAS_IP}:5000",
    "https://${NAS_IP}:5001",
    "http://${NAS_IP}:8080",
    "http://${NAS_IP}:80",
    "https://${NAS_IP}:443",
    "https://${NAS_IP}:9090"
)

foreach ($url in $urls) {
    try {
        [System.Net.ServicePointManager]::ServerCertificateValidationCallback = { $true }
        $response = Invoke-WebRequest -Uri $url -TimeoutSec 3 -UseBasicParsing -ErrorAction Stop
        Write-Host "    OK    - $url -> HTTP $($response.StatusCode)" -ForegroundColor Green
    } catch [System.Net.WebException] {
        $status = $_.Exception.Response.StatusCode.value__
        if ($status) {
            Write-Host "    OK    - $url -> HTTP $status" -ForegroundColor Yellow
        } else {
            Write-Host "    FALLO - $url -> Sin respuesta" -ForegroundColor Red
        }
    } catch {
        Write-Host "    FALLO - $url -> Sin respuesta" -ForegroundColor Red
    }
}
Write-Host ""

# 4. Tailscale
Write-Host "[4] Estado de Tailscale..." -ForegroundColor Yellow
if (Get-Command tailscale -ErrorAction SilentlyContinue) {
    Write-Host "    Tailscale instalado" -ForegroundColor Green
    tailscale status
} else {
    Write-Host "    Tailscale no encontrado en PATH" -ForegroundColor Red
    if (Test-Path "C:\Program Files\Tailscale\tailscale.exe") {
        Write-Host "    Encontrado en C:\Program Files\Tailscale\" -ForegroundColor Yellow
        & "C:\Program Files\Tailscale\tailscale.exe" status
    }
}
Write-Host ""

# 5. Compartidos SMB
Write-Host "[5] Buscando carpetas compartidas..." -ForegroundColor Yellow
try {
    net view \\$NAS_IP 2>&1
} catch {
    Write-Host "    No se pudieron listar carpetas compartidas" -ForegroundColor Red
}
Write-Host ""

Write-Host "=========================================" -ForegroundColor Cyan
Write-Host "  Diagnóstico completo" -ForegroundColor Cyan
Write-Host "=========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Si los puertos web estan cerrados pero SMB (445) esta abierto,"
Write-Host "el servicio web del NAS se cayo. Reinicia el NAS desde el boton fisico."
Write-Host ""
Write-Host "Si nada responde, revisa el cable de red o el switch."
