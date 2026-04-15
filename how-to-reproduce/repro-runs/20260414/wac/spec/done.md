## Done when

Every tag (backtick-wrapped, starting with §) in this goal's files defines a
testable requirement. Each one must have a corresponding test verifying the
stated behavior.

The single entry point for this goal is `wacx` (see [cli/main.md](cli/main.md)).
All tags must be covered by tests reachable from this entry point.
