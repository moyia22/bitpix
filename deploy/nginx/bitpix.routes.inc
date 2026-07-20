# =====================================================================
# BitPix — regras de roteamento compartilhadas entre HTTP e HTTPS.
# Incluído por bitpix.conf.
# =====================================================================

# Cabeçalhos comuns de proxy (IP real, protocolo, host).
proxy_set_header Host              $host;
proxy_set_header X-Real-IP         $remote_addr;
proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
proxy_set_header X-Forwarded-Proto $scheme;
proxy_http_version 1.1;

client_max_body_size 5m;

# --------- Webhook Mercado Pago (público, não autenticado) -----------
# Preserva o corpo original e cabeçalhos de assinatura. NÃO exige login.
location = /api/v1/webhooks/mercado-pago {
  limit_req zone=webhook burst=40 nodelay;
  proxy_pass http://bitpix_api;
  proxy_request_buffering on;      # entrega o corpo completo ao backend
  proxy_set_header Connection "";
  proxy_read_timeout 30s;
  proxy_send_timeout 30s;
}

# --------- SSE (eventos de cobrança em tempo real) -------------------
# buffering DESLIGADO, cache off, timeout longo, keepalive.
location ~ ^/api/v1/pix/charges/[^/]+/events$ {
  proxy_pass http://bitpix_api;
  proxy_buffering off;
  proxy_cache off;
  proxy_set_header Connection "";
  proxy_read_timeout 3600s;
  proxy_send_timeout 3600s;
  chunked_transfer_encoding off;
  add_header X-Accel-Buffering no;
}

# --------- API REST --------------------------------------------------
location /api/ {
  proxy_pass http://bitpix_api;
  proxy_set_header Connection "";
  proxy_read_timeout 60s;
}

# --------- Health checks (restrinja em produção se necessário) --------
location /health/ {
  proxy_pass http://bitpix_api;
  proxy_set_header Connection "";
  # Ex.: limitar às redes internas de monitoramento:
  # allow 10.0.0.0/8; deny all;
}

# --------- Frontend (Next.js), incluindo WebSocket de dev ------------
location / {
  proxy_pass http://bitpix_web;
  proxy_set_header Upgrade $http_upgrade;
  proxy_set_header Connection $connection_upgrade;
  proxy_read_timeout 60s;
}
