# Writing Project MCP

The process exposes manuscript/volume CRUD over stdio. It has no filesystem
or project-domain access: every request is authenticated by a short-lived
loopback capability issued by the Electron main process and executed by the
project domain services.
