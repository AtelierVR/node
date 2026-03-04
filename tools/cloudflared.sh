# cloudflared.exe tunnel create noxnode
# cloudflared tunnel route dns noxnode nox.hactazia.fr
cloudflared tunnel --url http://localhost:5303 --no-chunked-encoding --proxy-keepalive-timeout 10m --proxy-connect-timeout 300s
 --proxy-tls-timeout 60s run noxnode
# _noxnode._tcp.hactazia.fr.	1	IN	SRV	0 5 443 avr.hactazia.fr.