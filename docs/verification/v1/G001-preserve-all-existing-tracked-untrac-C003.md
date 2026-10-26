# Identity origin and owned-resource regression evidence

Criterion G001/C003 is satisfied for the trusted origin/cookie and actual owned-resource query boundaries. This is not native desktop UI, full integration isolation or release acceptance.

Trusted web signin/enrollment/admin/member browser journeys and screenshots are retained in [the identity walkthrough](../identity-browser/walkthrough.md). Its final regression section records actual Better Auth/PostgreSQL session98115: seven scenarios include trusted views://mainview signin/session/logout and cookie/session behavior after the privacy fix, exit0 and exact cleanup. [Independent identity review](../reviews/identity-final-review.md) verifies the same handler/origin contract. No native desktop window was launched for that evidence.

Actual connection-store worker and coordinator31806 passed19 PostgreSQL scenarios, including A/B/admin/forged/removed actor denials and owner-scoped credentials/metadata. [Store review](../reviews/connection-007c3-review.md) and the current attempt's coordinator-connection-007c3.md bind tested source hashes and cleanup.

Actual owned run-store worker72180 and independent coordinator74183 both passed15 scenarios/seven observed races, exit0 with fixture/client/dedicated container-network cleanup and sticky new-network counter0. Cross-owner/admin requests cannot read/cancel A's run/result. Nested substitutions mix A's run with B's attempt, another A run's attempt, the foreign run with A's attempt and missing IDs: all return the same fixed not_found. Controlled sessions issue real005 ActiveActors backed by actual memberships; structurally forged actors reject before transactions and removed actors reject every store method. These service-level query proofs do not claim a new HTTP/login proof.

Current tested run proof SHA256: entrybd5a7609b0766fe3df93b184fa92466a664939d821ca34e700559480f630c6ff; cases14b92ad47dc96816de72488826022cdc6ea537ef4c5ab41b75e7cb6b09a48c4d; races6982a868b016f6cfbfe8e7211bd903cb3031a25e620511cb787b91e048383dc7. Product runsdfa9c25404e7d1779b6b3b30e9fde561420fd2afa38a917ab43a82307b3f0c87 and rows983ff7103d5ad6b93ffea3c68fc915a46475dd3546be2055ecc9e865d8c61b1a were accepted after independent offline review. Source is dirty and not represented by baseline HEAD alone.

Every future domain consumer still requires its own authorization/producer query and actual integration proof. This criterion closes the earlier missing representative real nested-resource query; it does not generalize one store's result to allv1 data or credentials.
