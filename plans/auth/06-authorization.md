---
connie-title: Authorization Model
---

# Authorization Model

## Authentication vs Authorization

Authentication answers:

> Who is the user?

Authorization answers:

> Is this user allowed to perform this operation?

Auth Service provides identity and authorization data, but business
services remain responsible for enforcing business rules.

## Initial Model

Use:

``` text
User
  |
  +--> Roles
          |
          +--> Permissions
```

Example:

``` text
trader
  ├── orders:read
  ├── orders:create
  └── orders:cancel
```

## Gateway Authorization

The gateway can perform coarse-grained checks such as:

- Is the request authenticated?
- Is the token valid?
- Is the required scope present?

## Service Authorization

Business services must enforce resource-level and business-specific
authorization.

Example:

``` text
Gateway:
    token is valid

Order Service:
    user has orders:create
    market is open
    order belongs to permitted account
    other business constraints are satisfied
```

Do not move all authorization decisions into the gateway.

## gRPC Authorization APIs

The Auth Service may expose APIs such as:

``` protobuf
service AuthService {
  rpc GetUser(GetUserRequest) returns (GetUserResponse);
  rpc CheckPermission(CheckPermissionRequest)
      returns (CheckPermissionResponse);
}
```

These are for cases where a service actually needs centralized
identity/permission information.

Do not call `CheckPermission` for every ordinary request if the required
authorization information can be validated locally.

## Future Policy Engine

**NOTE**: Policy does not need to be complex as of now. We have two roles: user and admin.

A policy engine such as OPA can be considered later if authorization
becomes sufficiently complex.

Do not introduce one in the initial implementation without a concrete
policy requirement.
