---
connie-title: Auth gRPC and Protobuf Integration
---

# Auth gRPC and Protobuf Integration

## Contract Ownership

Auth's internal service contract should live in the existing common
Protobuf contract repository.

The generated TypeScript SDK is the preferred client dependency for
TypeScript services.

## Initial Service Contract

A starting point can contain:

``` protobuf
service AuthService {
  rpc GetUser(GetUserRequest) returns (GetUserResponse);
  rpc CheckPermission(CheckPermissionRequest)
      returns (CheckPermissionResponse);
}
```

Authentication endpoints such as login and registration remain exposed
externally through the API Gateway.

The exact protobuf contract should be finalized before implementation.

## Why TypeScript

The platform already has:

- Fastify API Gateway.
- TypeScript SDK generation.
- Common Protobuf contracts.

Therefore Auth is implemented in TypeScript rather than adding a Python
protobuf-generation pipeline solely for Auth.

## SDK Usage

The generated SDK should provide:

- Common request/response types.
- gRPC clients.
- Shared enums and identifiers.
- Serialization definitions generated from Protobuf.

Do not put business logic into the generated SDK.

## Versioning

Protobuf changes must remain backward compatible according to the
project's contract/versioning rules.

Generated SDK versions should be released together with compatible
contract changes.

## Metadata

gRPC metadata can carry trusted request context such as:

- Request ID.
- Trace context.
- Service identity.
- Validated user context where required.

Client-supplied identity headers must never be blindly trusted.

## Error Mapping

Define a consistent mapping between:

- Protobuf/gRPC status codes.
- Internal domain errors.
- Gateway HTTP responses.

Avoid leaking internal database or cryptographic errors to clients.
