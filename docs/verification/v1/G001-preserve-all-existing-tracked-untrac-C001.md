# G001 C001: actual operator and enrollment journey

PASS,2026-10-22. Capture tree bb14dbf, base HEAD2ae41886484b66851b938ad88d18c804a2c742b6. This dirty shared tree is deliberately uncommitted; actual working-source identities below and the linked reviewed manifest identify tested source. No staging/commit/worktree was authorized.

Coordinator ran `bash scripts/verify-identity-auth.sh credential-operator` against fresh dedicated tmpfs PostgreSQL. Final source repetition session20554 exited0: all6 actual command checks passed, including closed-input denial, supported credential/bootstrap/audit, duplicate protection, stale expected-admin/unentitled orphan, activation-audit failure and effective old/new admin cookie revocation with unaffected third authentication. Exact dedicated container/network cleanup passed. Earlier worker and coordinator receipts remain in004e7/current attempt; they are not substituted for this final repetition.

Final actual Chromium fixture75714/web75376 passed admin signin, private invitation issuance, logout, member signup, session refresh, authenticated acceptance, member logout/signin and Dashboard without admin controls. Screenshot: `docs/verification/identity-browser/final-transactional-signup.png`. Full earlier removal/repair/responsive proof is in `docs/verification/identity-browser/walkthrough.md`.

Fixture75714 returned cleanup/close and exact Compose removal receipts, exit0. Web75376 stopped130 via Ctrl-C; tab2 closed. The subsequent bounded fault server36423 stopped0;3001/3002 listener inventory was empty. No real account or production data used.

Independent final review `docs/verification/reviews/identity-final-review.md`: WATCH/APPROVE, blockers:none. Focused correction checks36/209 independently and25/179 under the coordinator passed; strict/build/LSP evidence linked from004d4/004f5. Nonblocking source-format/SQL test pins remain documented.

Actual source SHA256: auth/index24f62096008c6e31a6037463e2bda3de3d1a3ecca870b1cfbd82286954d2a62c; invitation-policy f832a04c4459f7cea33035fb3bdd73dcfa412d38ce088f5044590a7f4a531a2b; signup.integration3b655eec3a83fd7a68ab6ee1633f396e796b5b37cbd6d72fcd036657f9d04a02; auth-client a9be510adc537a67069fdc5993939314e8677b3501c65cc6bee6343b44080f26; auth-transport c856674e1ae53d996928da5b48f5f3570fe085fe890864cc35bbddb9d608524a; user-menu0ab38cd122cddca3e014880887f55496b3ae0c60b85962852286d8a9c122f780. Remaining source hashes are in the final review and coordinator-identity-receipt.md.

This accepts RFC004/005 identity and core ownership contracts. Actual future domain queries/native integrations remain their own criteria; it does not claim complete v1.
