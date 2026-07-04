---
title: Project Security Document
---

# Security Guidelines

Security is critical for a peer-to-peer energy trading platform. This project handles financial transactions, user privacy, and operations that can affect the local electrical grid. Treat security as a first-class concern across design, implementation, and operations even though the system will not be deployed in a real production environment.

**NOTE**: Basic security practices are listed below. Make sure you follow them eventhough the project will not be hosted in a production environment due to cost and infra constraints!

## Threats to consider

- Financial fraud, market manipulation, or unauthorized transfers.
- Privacy leaks of user or usage data.
- Denial-of-service, resource exhaustion or grid-disruption attacks.
- Supply-chain compromises through malicious dependencies or CI artifacts.

## Secure development practices

- Adopt threat modeling early for major features and network flows.
- Follow least-privilege for services, keys, and users.
- Validate and sanitize all untrusted inputs; fail securely.
- Use strong authentication and fine-grained authorization.
- Encrypt sensitive data in transit (TLS) and at rest where required.
- Prefer well-vetted libraries.
- Log important security events and preserve audit trails securely.

## Dependency management (keep up-to-date)

**NOTE**: This is important because lots of new vulnerabilities are surfacing. We will setup depandabot alerts if needed.

- Pin dependency versions and commit lockfiles when applicable.
- Enable automated dependency scanning (Dependabot).
- Review changelogs for behavioral changes before merging updates.

## Secrets and credentials

- Never commit secrets to source control.
- Rotate keys and credentials periodically and on suspected compromise.

## CI/CD and testing

- Run tests, linters, dependency scans, and secret-detection in CI.
- Block merges when critical tests or security checks fail.
- Include security tests (unit, integration) where practical.

## Risks of “vibe coding” (quick hacks without process)

“Vibe coding” means making lots of changes without understanding, documenting, testing, or reviewing. This will increase the chance of introducing security flaws and technical debt. Using ai is different from vibecoding, find the balance. Avoid vibe coding by:

- Using feature branches, small PRs, and mandatory reviews.
- Turn off inline suggestions from copilot. Stick to ask, edit and plan if you must use them but use them at moderate amounts (or prefer llm as a faster search engine).
- By understanding that for this project specifically, your credits and usage limits will be over much faster if you write prompts without understanding what you wrote in the first place
- Requiring automated tests and basic security checks before merge.
- Documenting assumptions, limitations, and any temporary workarounds (this, please add a comment if you are working around a hacky fix or you generated some complex code that you did not understand but it works..).

## Incident and disclosure

**NOTE**: Will be filled later

