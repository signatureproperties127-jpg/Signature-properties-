# Test Credentials — Signature Realty CRM

## Auth Mode: DEMO_MODE (Enabled)

Set via env var `DEMO_MODE=true` in `/etc/supervisor/conf.d/realty.conf`.
When enabled, every API request is auto-authenticated as the first ADMIN user in the DB.
**No login required for using the app.**

### Auto-authenticated Actor
- **UserID**: `USR-0001`
- **Name**: System Admin
- **Email**: admin@sig.realty
- **Role**: ADMIN
- **Permissions**: `*` (all)
- **CompanyID**: COMP-001
- **BrokerageID**: BRK-001

### Other Seeded Users (available if DEMO_MODE disabled + Google OAuth configured)
| UserID | Name | Email | Role |
|---|---|---|---|
| USR-0001 | System Admin | admin@sig.realty | ADMIN |
| USR-0002 | Team Manager | manager@sig.realty | MANAGER |
| USR-0003 | Field Agent | agent@sig.realty | AGENT |

## To Disable Demo Mode (Production)
1. Edit `/etc/supervisor/conf.d/realty.conf` and change `DEMO_MODE="true"` to `DEMO_MODE="false"`
2. Configure Google OAuth client_id (see login.html + `/api/auth/config` endpoint)
3. Run: `sudo supervisorctl restart realty`

## Preview URL
- App: https://e6961d98-7d3f-45b6-bd35-6e53a7314088.preview.emergentagent.com/clients.html
- API base: https://e6961d98-7d3f-45b6-bd35-6e53a7314088.preview.emergentagent.com/api/
