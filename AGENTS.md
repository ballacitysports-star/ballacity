# Project Architecture Rules

- Guardian-to-team contact discovery must verify the guardian-child relationship and the child's team membership on the server before returning leader identities, because roster UI visibility is not an authorization boundary.