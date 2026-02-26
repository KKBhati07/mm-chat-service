# Local HTTPS Certificates (Development Only)

This folder is used for **local HTTPS development**.

## ❌ Do NOT commit certificate files
Certificate files contain private keys and must remain local.

Ignored files:
- wildcard.marketmate.local.pem
- wildcard.marketmate.local-key.pem

## ✅ How to generate (local dev)
1. Install mkcert
2. Run:
   mkcert "marketmate.local" "*.marketmate.local"
3. Place generated files in this folder

Used only for local development.
