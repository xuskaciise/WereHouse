# System Update Summary (Kooban)

Document-kan wuxuu kooban yahay update-yadii waaweynaa ee lagu sameeyay `Siu Warehouse` system-ka.

## 1) Branding & UI
- Logo-ga system-ka waxaa loo beddelay `SIU logo`.
- Magaca app-ka waxaa loo beddelay `Siu Warehouse`.
- Login/Register qoraallo ayaa la hagaajiyay:
  - `Create Account` -> `Student Register`
  - `Username` -> `ID Number` (signup section).

## 2) Sidebar Refactor (Workflow-based)
- Sidebar-ka waxaa loo habeeyay sections:
  - Core
  - Master Data
  - Procurement (Inbound)
  - Inventory Control
  - Sales & Finance
  - System
- Active link logic waa la saxay si exact match only uu u noqdo (hal menu kaliya active mar kasta).

## 3) Warehouse Management Improvements
- Warehouse detail/list pages waxay ka shaqeynayaan data dhab ah (API), mock data lama isticmaalayo.
- Capacity usage, total items, unique SKUs calculations waa la saxay.
- Edit/Delete warehouse waa la daray.
- Warehouse leh stock lama delete-gareyn karo.
- Warehouse save wuxuu keydiyaa `userId` (current user).

## 4) Product Module Updates
- Product registration:
  - Initial quantity field waa laga saaray create form.
  - Quantity editing waxay ku koobantahay product existing stock.
- Product table + API:
  - `issueDate` iyo `expireDate` fields waa lagu daray DB/UI/API.
- Product date validation (frontend + backend):
  - Production date waa inuusan dhaafin maanta.
  - Expiry date waa inuu ka dambeeyo production date.
  - Shelf life waa ugu yaraan 180 maalmood.

## 5) Purchase & Sales Stock Automation
- Purchase Order issuance:
  - Stock si automatic ah ayuu u kordhaa (`upsert` by `productId + warehouseId`).
  - `userId` waxaa lagu keydiyaa stock record.
- Sales Order issuance:
  - Stock si automatic ah ayuu u yaraadaa.
  - Insufficient stock checks ayaa jira.

## 6) Sales Frontend Validation
- Create Sale form:
  - Frontend wuxuu hubiyaa quantity vs available stock kahor submit.
  - Toast error cad ayaa soo baxa marka stock-ku yaryahay.
  - Finalize button waa la disable-gareeyaa haddii stock-ku ku filneyn.
  - Backend 400 error message si toos ah ayaa user-ka loo tusaa.

## 7) Supplier/Payment Stability Fixes
- Missing `balance` column issues waxaa loo sameeyay fallback logic (safe query/select handling).
- Supplier and payment endpoints error handling waa la adkeeyay.

## 8) Reports System (Filterable)
- Reports page cusub:
  - Purchase Report: Date range, Supplier, Status filters.
  - Sales Report: Warehouse, Customer, Date filters.
  - Payments Report: Total, Paid, Balance (sales + purchases linked).
- `Clear Filters` button waa lagu daray.

## 9) User Approval & Access Control
- User status workflow:
  - `PENDING`, `APPROVED`, `REJECTED`.
- Login waxaa laga xannibay users aan approved ahayn.
- Admin Users page:
  - Bulk `Approve All` / `Reject All` + individual approve/reject.
  - Buttons iyo logic waa la hagaajiyay.

## 10) RBAC + Data Ownership
- Data ownership (`userId`) ayaa lagu daray tables badan.
- Admin wuxuu arkaa dhammaan data.
- Student wuxuu arkaa data-giisa oo kaliya (`userId` filter).
- API routes badan waxaa lagu daray ownership checks + unauthorized/forbidden handling.

## 11) Danger Zone (System Reset)
- Settings page waxaa lagu daray Danger Zone.
- Reset operation:
  - Admin-only
  - `TRUNCATE` confirmation required
  - Admin password confirmation required
  - `users` table lama taabanayo.

## 12) Build & TypeScript Fixes
- Headers type mismatch (`HeadersInit`) issue waa la saxay (type-safe `Record<string, string>`).
- Build command wuxuu maray successfully kadib lock issues la xaliyay.

---

Haddii aad rabto, document-kan waxaan ka sii dhigi karaa:
- **Technical version** (file-by-file changes), ama
- **Non-technical release note** (manager/client ready).
