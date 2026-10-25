# Control CLI entry reviews

Issue: Refs #111. Base: 1728a4ee9872719b551f4de1667cdd6e115fa840.

gateway_impl implemented the change. The coordinator and mac_agent_probe
independently reviewed canonical entry detection, direct/directory/file symlink
subprocess tests, error redaction and silent module import behavior.
The coordinator traced the actual vm6 zero-exit/no-listener failure to the
lexical argv/current versus canonical import.meta.url mismatch. mac_agent_probe
independently reran the three CLI tests. Both reviews pass with no open findings.

Reviewed source SHA-256:
45eab47a91982a03eb2438a32d8fb4650c03024be48b7c1976fe3a790849a1bb.
The same canonicalization covers the default current symlink in the reviewed
systemd template. Existing private configuration validation and bounded runtime
shutdown remain in place. This review does not claim physical phone acceptance.
