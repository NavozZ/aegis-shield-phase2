# Architecture Documentation

This directory will hold the current architectural model for AEGIS Shield. Diagrams should identify trust boundaries, data ownership, security controls, and important failure behavior. Update this document and the relevant ADR whenever an implementation decision changes the model.

## Context diagram

To be completed during implementation. It will show customers, agents, administrators, external dependencies, banking channels, and the AEGIS Shield trust boundary.

## Container diagram

To be completed during implementation. It will show user-facing applications, gateway, independent services, service-owned data stores, messaging, and observability components.

## Service responsibilities

To be completed during implementation. It will define each service's capabilities, public and internal interfaces, dependencies, and prohibited responsibilities.

## Data ownership

To be completed during implementation. It will map authoritative records to their owning service and document replication, event, retention, and reconciliation boundaries.

## Authentication flow

To be completed during implementation. It will cover customer authentication, workload identity, token validation, authorization, revocation, and audit evidence.

## Transfer flow

To be completed during implementation. It will cover idempotency, double-entry posting, consistency boundaries, failure states, and customer-visible outcomes.

## SABCL flow

To be completed during implementation. It will compare baseline and SABCL-protected communication and identify metadata, cryptographic, routing, and observability boundaries.

## Failure and recovery flow

To be completed during implementation. It will show detection, isolation, failover, restore, reconciliation, tamper-evidence verification, and safe return to service.
